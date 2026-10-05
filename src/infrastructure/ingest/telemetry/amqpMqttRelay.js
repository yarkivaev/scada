import durableConsume from '../durableConsume.js';
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
function subscribeRelay(queue, prefetch, sink) {
    return async (channel) => {
        await channel.assertQueue(queue, { durable: true });
        channel.prefetch(prefetch);
        const onMessage = relayConsumer(sink, channel);
        const tag = await channel.consume(queue, onMessage, { noAck: false });
        return tag.consumerTag;
    };
}

export default function amqpMqttRelay(amqpUrl, queue, sink, options = {}) {
    const prefetch = options.prefetch || 32;
    let opened = false;
    const session = durableConsume(
        amqpUrl,
        subscribeRelay(queue, prefetch, sink),
        options
    );
    return {
        start() {
            if (!opened) {
                opened = true;
                sink.start();
            }
            return session.start();
        },
        async stop() {
            await session.stop();
            sink.stop();
        }
    };
}
