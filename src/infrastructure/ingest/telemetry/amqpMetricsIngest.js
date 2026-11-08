import { amqpSource } from '../../streams/index.js';
import ingestBatch from '../ingestBatch.js';
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
    function seen() {
        if (typeof onSeen !== 'function') { return; }
        const name = streamNameFromTopic(record.topic);
        if (name) {
            onSeen(name);
        }
    }
    const accepted = codec.accept({ topic: record.topic, payload: record.payload.toString() });
    if (accepted?.then) { return accepted.then((value) => { seen(); return value; }); }
    seen();
    return accepted;
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
            return undefined;
        }
        const accepted = acceptTelemetryDeliver(codec, msg.fields, msg.content, onSeen);
        if (accepted && typeof accepted.then === 'function') {
            return accepted.then(() => { channel.ack(msg); });
        }
        channel.ack(msg);
        return undefined;
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
    // Unacknowledged deliveries occupy the broker window until the batch commits.
    // A larger batch can never fill and would throttle ingestion to the flush timer.
    const size = Math.min(options.size ?? 100, prefetch);
    const collector = ingestBatch(sink, { ...options, size });
    const codec = metricsCodec(collector, console, { requireTimestamp: sink.requireTimestamp === true });
    const session = amqpSource(amqpUrl, queue, {
        accept(delivery) {
            return acceptTelemetryDeliver(codec, delivery.fields, delivery.content, options.onSeen);
        }
    }, { ...options, prefetch });
    return {
        start() {
            return session.start();
        },
        async stop() {
            await session.stop();
            await collector.stop();
        }
    };
}
