import {
    batch,
    circuit,
    clickhouseSink,
    clock,
    lokiSource,
    timedBatch
} from '@yarkivaev/source-to-sink';
import activityCodec from './activityTransformer.js';

/**
 * Pipeline for streaming Loki HTTP access logs to ClickHouse.
 *
 * Polls Loki for log entries matching the query and batches them
 * before inserting into ClickHouse `activity.http_access` table.
 * Uses circuit breaker for failure isolation.
 *
 * @example
 *   const pipeline = activityTracking(
 *     'http://localhost:3100',
 *     'http://localhost:8123',
 *     '{app="traefik"}',
 *     { poll: 10, size: 100, interval: 5, threshold: 5, timeout: 60 }
 *   );
 *   pipeline.start();
 *   // ... later
 *   pipeline.stop();
 *
 * @param {string} loki - Loki base URL
 * @param {string} clickhouse - ClickHouse URL
 * @param {string} query - LogQL query string
 * @param {object} config - Pipeline configuration
 * @param {number} config.poll - Loki polling interval in seconds
 * @param {number} config.size - Batch size before flush
 * @param {number} config.interval - Seconds before time-based flush
 * @param {number} config.threshold - Circuit breaker failure threshold
 * @param {number} config.timeout - Circuit breaker timeout in seconds
 * @returns {object} Pipeline with start() and stop() methods
 */
export default function activityTracking(loki, clickhouse, query, config) {
    if (typeof loki !== 'string' || loki.length === 0) {
        throw new Error('Loki URL must be a non-empty string');
    }
    if (typeof clickhouse !== 'string' || clickhouse.length === 0) {
        throw new Error('ClickHouse URL must be a non-empty string');
    }
    if (typeof query !== 'string' || query.length === 0) {
        throw new Error('Query must be a non-empty string');
    }
    if (!config || typeof config !== 'object') {
        throw new Error('Config must be an object');
    }
    const clk = clock();
    const breaker = circuit(config.threshold, config.timeout, clk);
    const sink = clickhouseSink(clickhouse, 'activity.http_access');
    const collector = timedBatch(batch(sink, config.size, breaker), config.interval);
    const transformer = activityCodec(collector);
    const source = lokiSource(loki, query, config.poll, transformer, clk);
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
