import amqp from 'amqplib';
import deliverToMqttRecord from './deliverToMqttRecord.js';

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
    function consume(msg) {
        if (!msg) {
            return;
        }
        const record = deliverToMqttRecord(msg.fields, msg.content);
        sink.write([record]);
        session.channel.ack(msg);
    }
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
            const tag = await ch.consume(queue, consume, { noAck: false });
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
