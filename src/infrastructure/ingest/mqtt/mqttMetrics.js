import {
    batch,
    circuit,
    clock,
    mqttSource,
    timedBatch
} from '@yarkivaev/source-to-sink';
import metricsCodec from './metricsTransformer.js';

/**
 * Pipeline for streaming MQTT sensor data to a storage sink.
 *
 * Subscribes to MQTT topic and batches messages before writing
 * to the provided sink. Uses circuit breaker for failure isolation
 * and time-based flushing for low-volume periods.
 *
 * @example
 *   import { clickhouseSink } from '@yarkivaev/source-to-sink';
 *   const sink = clickhouseSink('http://localhost:8123', 'scada.metrics');
 *   const pipeline = mqttMetrics(
 *     'mqtt://localhost:1883',
 *     sink,
 *     'sensors/#',
 *     { size: 100, interval: 5, threshold: 5, timeout: 60 }
 *   );
 *   pipeline.start();
 *   // ... later
 *   pipeline.stop();
 *
 * @param {string} mqtt - MQTT broker URL
 * @param {object} sink - Sink with write(records) method
 * @param {string} topic - MQTT topic pattern to subscribe
 * @param {object} config - Pipeline configuration
 * @param {number} config.size - Batch size before flush
 * @param {number} config.interval - Seconds before time-based flush
 * @param {number} config.threshold - Circuit breaker failure threshold
 * @param {number} config.timeout - Circuit breaker timeout in seconds
 * @param {string} [config.clientId] - MQTT client ID for persistent sessions
 * @param {number} [config.sessionExpiryInterval] - Session expiry in seconds (default 3600)
 * @returns {object} Pipeline with start() and stop() methods
 */
export default function mqttMetrics(mqtt, sink, topic, config) {
    if (typeof mqtt !== 'string' || mqtt.length === 0) {
        throw new Error('MQTT URL must be a non-empty string');
    }
    if (!sink || typeof sink.write !== 'function') {
        throw new Error('Sink must have a write(records) method');
    }
    if (typeof topic !== 'string' || topic.length === 0) {
        throw new Error('Topic must be a non-empty string');
    }
    if (!config || typeof config !== 'object') {
        throw new Error('Config must be an object');
    }
    const clk = clock();
    const breaker = circuit(config.threshold, config.timeout, clk);
    const collector = timedBatch(batch(sink, config.size, breaker), config.interval);
    const transformer = metricsCodec(collector);
    const source = mqttSource(mqtt, topic, transformer, {
        clientId: config.clientId,
        sessionExpiryInterval: config.sessionExpiryInterval
    });
    return {
        /**
         * Starts the pipeline.
         */
        start() {
            source.start();
        },
        /**
         * Stops the pipeline.
         */
        stop() {
            source.stop();
            collector.stop();
        }
    };
}
