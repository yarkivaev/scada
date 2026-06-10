import amqp from 'amqplib';
import deliverToMqttRecord from './deliverToMqttRecord.js';

/**
 * Builds a queue consumer callback bound to one AMQP channel.
 *
 * @param {object} sink - sink with write(records)
 * @param {object} channel - amqplib channel with ack(msg)
 * @returns {Function} consume callback for ch.consume
 */
export function relayConsumer(sink, channel) {
    return (msg) => {
        if (!msg) {
            return;
        }
        const record = deliverToMqttRecord(msg.fields, msg.content);
        sink.write([record]);
        channel.ack(msg);
    };
}

/**
 * AMQP queue consumer that republishes messages to MQTT using routing key as topic.
 *
 * @example
 *   import { mqttSink } from '@yarkivaev/source-to-sink';
 *   const sink = mqttSink('mqtt://localhost:1883', { qos: 1 });
 *   const relay = amqpMqttRelay('amqp://localhost', 'scada.telemetry.ingest', sink);
 *   relay.start();
 *
 * @param {string} amqpUrl - RabbitMQ AMQP URL
 * @param {string} queue - Durable queue name to consume
 * @param {object} sink - mqttSink with start, stop, write
 * @param {object} [options] - prefetch count
 * @returns {object} Relay with start and stop
 */
export default function amqpMqttRelay(amqpUrl, queue, sink, options = {}) {
    const prefetch = options.prefetch || 32;
    let session;
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
            sink.start();
            const onMessage = relayConsumer(sink, ch);
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
            sink.stop();
        }
    };
}
