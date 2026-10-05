import { batch, circuit, clock, timedBatch } from '@yarkivaev/source-to-sink';
import durableConsume from '../durableConsume.js';
import deliverToMqttRecord from './deliverToMqttRecord.js';
import metricsCodec from '../mqtt/metricsTransformer.js';
import streamNameFromTopic from './streamNameFromTopic.js';

/**
 * Maps AMQP deliver to raw metrics message for metricsCodec.
 *
 * @param {object} codec - metricsCodec instance
 * @param {object} fields - AMQP deliver fields
 * @param {Buffer} content - message body
 * @param {Function} [onSeen] - optional callback(streamName) for edge freshness
 */
export function acceptTelemetryDeliver(codec, fields, content, onSeen) {
    const record = deliverToMqttRecord(fields, content);
    if (typeof onSeen === 'function') {
        const name = streamNameFromTopic(record.topic);
        if (name) {
            onSeen(name);
        }
    }
    codec.accept({ topic: record.topic, payload: record.payload.toString() });
}

/**
 * Builds a queue consumer callback bound to one AMQP channel.
 *
 * @param {object} codec - metricsCodec instance
 * @param {object} channel - amqplib channel with ack(msg)
 * @param {Function} [onSeen] - optional edge freshness callback
 * @returns {Function} consume callback for ch.consume
 */
export function telemetryConsumer(codec, channel, onSeen) {
    return (msg) => {
        if (!msg) {
            return;
        }
        acceptTelemetryDeliver(codec, msg.fields, msg.content, onSeen);
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
function subscribeMetrics(queue, prefetch, codec, onSeen) {
    return async (channel) => {
        await channel.assertQueue(queue, { durable: true });
        channel.prefetch(prefetch);
        const onMessage = telemetryConsumer(codec, channel, onSeen);
        const tag = await channel.consume(queue, onMessage, { noAck: false });
        return tag.consumerTag;
    };
}

export default function amqpMetricsIngest(amqpUrl, queue, sink, options = {}) {
    const prefetch = options.prefetch || 32;
    const size = options.size || 100;
    const interval = options.interval || 5;
    const threshold = options.threshold || 5;
    const timeout = options.timeout || 60;
    const clk = clock();
    const breaker = circuit(threshold, timeout, clk);
    const collector = timedBatch(batch(sink, size, breaker), interval);
    const codec = metricsCodec(collector);
    const session = durableConsume(
        amqpUrl,
        subscribeMetrics(queue, prefetch, codec, options.onSeen),
        options
    );
    return {
        start() {
            return session.start();
        },
        async stop() {
            await session.stop();
            collector.stop();
        }
    };
}
