import amqp from 'amqplib';
import { batch, circuit, clock, timedBatch } from '@yarkivaev/source-to-sink';
import deliverToMqttRecord from './deliverToMqttRecord.js';
import metricsCodec from '../mqtt/metricsTransformer.js';

/**
 * Maps AMQP deliver to raw metrics message for metricsCodec.
 *
 * @param {object} codec - metricsCodec instance
 * @param {object} fields - AMQP deliver fields
 * @param {Buffer} content - message body
 */
export function acceptTelemetryDeliver(codec, fields, content) {
    const record = deliverToMqttRecord(fields, content);
    codec.accept({ topic: record.topic, payload: record.payload.toString() });
}

/**
 * Builds a queue consumer callback bound to one AMQP channel.
 *
 * @param {object} codec - metricsCodec instance
 * @param {object} channel - amqplib channel with ack(msg)
 * @returns {Function} consume callback for ch.consume
 */
export function telemetryConsumer(codec, channel) {
    return (msg) => {
        if (!msg) {
            return;
        }
        acceptTelemetryDeliver(codec, msg.fields, msg.content);
        channel.ack(msg);
    };
}

/**
 * AMQP queue consumer that writes federated telemetry to a metrics sink.
 *
 * @param {string} amqpUrl - RabbitMQ AMQP URL
 * @param {string} queue - Durable queue name to consume
 * @param {object} sink - sink with write(records)
 * @param {object} [options] - batch and prefetch options
 * @returns {object} ingest with start and stop
 */
export default function amqpMetricsIngest(amqpUrl, queue, sink, options = {}) {
    const prefetch = options.prefetch || 32;
    const size = options.size || 100;
    const interval = options.interval || 5;
    const threshold = options.threshold || 5;
    const timeout = options.timeout || 60;
    let session;
    const clk = clock();
    const breaker = circuit(threshold, timeout, clk);
    const collector = timedBatch(batch(sink, size, breaker), interval);
    const codec = metricsCodec(collector);
    return {
        async start() {
            if (session) {
                return;
            }
            const conn = await amqp.connect(amqpUrl);
            const ch = await conn.createChannel();
            if (session) {
                await ch.close();
                await conn.close();
                return;
            }
            await ch.assertQueue(queue, { durable: true });
            ch.prefetch(prefetch);
            const onMessage = telemetryConsumer(codec, ch);
            const tag = await ch.consume(queue, onMessage, { noAck: false });
            session = { conn, channel: ch, tag: tag.consumerTag };
        },
        async stop() {
            const active = session;
            if (!active) {
                return;
            }
            session = undefined;
            await active.channel.cancel(active.tag);
            await active.channel.close();
            await active.conn.close();
            collector.stop();
        }
    };
}
