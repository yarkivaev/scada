import { clickhouseSink } from '@yarkivaev/source-to-sink';
import amqpMetricsIngest from '../infrastructure/ingest/telemetry/amqpMetricsIngest.js';
import foldedMetricsSink from './foldedMetricsSink.js';
import bindSilentStreams from './bindSilentStreams.js';

/**
 * Resolves the ClickHouse HTTP URL from site env.
 *
 * @param {object} env - process env
 * @returns {string|undefined} URL
 */
function clickhouseMetricsUrl(env) {
    return env.CLICKHOUSE_URL
        || (env.CLICKHOUSE_HOST ? `http://${env.CLICKHOUSE_HOST}:8123` : undefined);
}

/**
 * Starts AMQP telemetry ingest into a metrics sink.
 *
 * @param {object} env - process env
 * @param {object} sink - metrics sink
 * @param {function} onSeen - silent-stream callback
 * @param {object} batchConfig - size interval threshold timeout
 * @returns {object|undefined} ingest handle
 */
function startAmqpMetrics(env, sink, onSeen, batchConfig) {
    if (!env.AMQP_URL) {
        return undefined;
    }
    const ingest = amqpMetricsIngest(
        env.AMQP_URL,
        env.AMQP_QUEUE || 'scada.telemetry.ingest',
        sink,
        {
            size: batchConfig.size,
            interval: batchConfig.interval,
            threshold: batchConfig.threshold,
            timeout: batchConfig.timeout,
            prefetch: parseInt(env.AMQP_PREFETCH || '32', 10),
            onSeen
        }
    );
    ingest.start();
    return ingest;
}

/**
 * Starts central AMQP telemetry ingest and optional silent streams.
 *
 * @param {object} env - process env
 * @param {object} [streams] - silent Modbus streams
 * @param {object} batchConfig - MQTT/AMQP batch options
 * @param {object} pool - pg Pool
 * @param {object} [devices] - OPC UA device to machine map
 * @returns {object|undefined} ingest handles
 */
export default function startTelemetryIngest(env, streams, batchConfig, pool, devices) {
    if (env.SINK_DB_PROFILE === 'edge' || (!env.AMQP_URL && !streams)) {
        return undefined;
    }
    const url = clickhouseMetricsUrl(env);
    if (!url) {
        throw new Error('CLICKHOUSE_URL or CLICKHOUSE_HOST is required for AMQP telemetry ingest');
    }
    const sink = foldedMetricsSink(clickhouseSink(url, 'scada.metrics'), pool, devices);
    const onSeen = bindSilentStreams(streams, sink);
    const ingest = startAmqpMetrics(env, sink, onSeen, batchConfig);
    if (streams) {
        streams.start();
    }
    return { ingest, streams };
}
