import ingestHealth from '../ingestHealth.js';
import telemetrySink, { validateTelemetryPolicy } from './telemetrySink.js';
import mqttMetrics from '../../infrastructure/ingest/mqtt/mqttMetrics.js';
import amqpMetricsIngest from '../../infrastructure/ingest/telemetry/amqpMetricsIngest.js';
import operationSyncIngest from '../../infrastructure/sync/operationSyncIngest.js';
import operationsFromPg from '../../infrastructure/persistence/pg/operations.js';
import { metricsSinkFromPool } from '../../infrastructure/persistence/pg/metrics.js';
import postgresPool from '../../infrastructure/persistence/postgresPool.js';
import foldedMetricsSink from '../foldedMetricsSink.js';
import silentStreams from '../../infrastructure/ingest/modbus/silentStreams.js';
import mx210Tcp from '../../infrastructure/ingest/modbus/mx210Tcp.js';
import segmentPipeline from '../../infrastructure/ingest/pipelines/segmentPipeline.js';
import decisionPipeline from '../../infrastructure/ingest/pipelines/decisionPipeline.js';
import alertPipeline from '../../infrastructure/ingest/pipelines/alertPipeline.js';
import resolveSecrets from './resolveSecrets.js';

function urlOptions(spec) {
    const protocols = { mqtt: ['mqtt:', 'mqtts:', 'ws:', 'wss:'], amqp: ['amqp:', 'amqps:'], stomp: ['stomp:', 'stomps:'],
        postgres: ['postgres:', 'postgresql:'], clickhouse: ['http:', 'https:'] };
    Object.entries(protocols).forEach(([key, allowed]) => {
        const value = spec[key];
        if (value === undefined || value?.$secret) { return; }
        if (typeof value !== 'string' || !allowed.includes(new URL(value).protocol)) { throw new TypeError(`Invalid ${key} URL`); }
    });
}
function boundedOptions(spec) {
    const maxRecords = Math.min(spec.options?.maxRecords ?? 1000, spec.limits?.maxRecords ?? 1024);
    const maxBytes = Math.min(spec.options?.maxBytes ?? 1048576, spec.limits?.maxBytes ?? 1048576);
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        throw new TypeError('Ingest limits must be positive safe integers');
    }
    return { ...spec.options, maxRecords, maxBytes, maxMessageBytes: maxBytes, maxPendingBytes: maxBytes, size: Math.min(spec.options?.size ?? 100, maxRecords),
        prefetch: Math.min(spec.options?.prefetch ?? 32, maxRecords) };
}
function ownedSink(pipeline, sink) {
    return { async start() { await sink.start?.(); return pipeline.start(); }, async stop() {
        try { await pipeline.stop(); } finally { await sink.stop?.(); }
    } };
}
function together(items) {
    return {
        start() { return Promise.all(items.map((item) => { return item.start(); })); },
        async stop() {
            const results = await Promise.allSettled(items.map((item) => { return item.stop(); }));
            const failure = results.find((result) => { return result.status === 'rejected'; });
            if (failure) { throw failure.reason; }
        }
    };
}
function borrowed(pool) {
    return { query(...args) { return pool.query(...args); }, connect() { return pool.connect(); },
        end() { return Promise.resolve(); } };
}
function telemetry(spec, pool) {
    const inner = spec.clickhouse ? telemetrySink(spec, pool) : metricsSinkFromPool(pool, { firstWins: spec.firstWins === true });
    return foldedMetricsSink(inner, pool, spec.devices);
}
function metrics(spec, pool, context) {
    const sink = telemetry(spec, pool);
    return ownedSink(amqpMetricsIngest(spec.amqp, spec.queue, sink, { ...boundedOptions(spec), budget: context.budget }), sink);
}
function mqttPostgres(spec, pool, context) {
    let failed = false;
    context.report?.({ state: 'degraded' });
    const sink = telemetry(spec, pool);
    return ownedSink(mqttMetrics(spec.mqtt, sink, spec.topic, {
        ...boundedOptions(spec), budget: context.budget,
        onReady() { if (!failed) { context.report?.({ state: 'running' }); } },
        onError(error) {
            // An uncertain write retires the executor. Reconnect cannot safely
            // reuse the poisoned batch or overlap SQL still running in its pool.
            failed ||= ['WRITE_TIMEOUT', 'OPERATION_TIMEOUT'].includes(error.code);
            context.report?.({ state: failed ? 'failed' : 'degraded', fatal: failed });
        }
    }), sink);
}
function silent(spec, pool, context) {
    const sink = telemetry(spec, pool);
    const streams = silentStreams({ budget: spec.budget, interval: spec.interval,
        sources: spec.sources.map((source) => { return mx210Tcp(source.name, source.host, source.port); }),
        onError() { context.report?.({ state: 'degraded' }); } });
    streams.bind(sink);
    const ingest = amqpMetricsIngest(spec.amqp, spec.queue, sink, {
        ...boundedOptions(spec), budget: context.budget, onSeen(name) { streams.seen(name); }
    });
    return ownedSink(together([ingest, streams]), sink);
}
function stomp(spec, pool, context) {
    const shared = borrowed(pool);
    const health = ingestHealth({ onFatal(error) {
        context.report?.({ state: 'failed', fatal: true, reason: error.code ?? error.name });
    } });
    function report() {
        const status = health.status();
        let state = status.ready ? 'running' : 'degraded';
        if (!status.live) { state = 'failed'; }
        context.report?.({ state, fatal: !status.live });
    }
    const config = { ...spec.config, ...boundedOptions({ ...spec, options: spec.config }), budget: context.budget,
        onFatal(error) { health.fail(error); }, onState: report };
    const items = [segmentPipeline(spec.stomp, spec.postgres, shared, config),
        decisionPipeline(spec.stomp, shared, config), alertPipeline(spec.stomp, shared, config)];
    health.track(items);
    const group = together(items);
    return { async start() { await group.start(); health.started(); report(); },
        stop() { return group.stop(); } };
}
function close(state) {
    state.closing ??= Promise.resolve().then(async () => {
        try { await state.pipeline?.stop(); } finally { await state.pool?.end(); }
    });
    return state.closing;
}
function task(factory, spec, context) {
    const state = { pipeline: null, pool: null, stopped: false };
    return {
        async start() {
            if (state.stopped) { throw new Error('Ingest task stopped'); }
            context.signal.throwIfAborted();
            const resolved = resolveSecrets(spec, context.secrets);
            urlOptions(resolved);
            state.pool = resolved.postgres ? postgresPool({ connectionString: resolved.postgres }) : null;
            try {
                state.pipeline = factory(resolved, state.pool, context);
                await state.pipeline.start();
                context.signal.throwIfAborted();
            } catch (error) {
                await close(state);
                throw error;
            }
        },
        async stop() {
            state.stopped = true;
            await close(state);
        }
    };
}
function required(spec, keys) {
    keys.forEach((key) => { if (!spec[key]) { throw new TypeError(`Missing ingest ${key}`); } });
}
function silentConfig(spec) {
    if (!spec.clickhouse && !spec.postgres) { throw new TypeError('Missing silent metrics storage'); }
    if (spec.devices && Object.keys(spec.devices).length && !spec.postgres) { throw new TypeError('Missing folding postgres'); }
    if (![spec.budget, spec.interval].every((value) => { return Number.isFinite(value) && value > 0; })) {
        throw new TypeError('Silent budget and interval must be positive');
    }
    if (!Array.isArray(spec.sources) || !spec.sources.length || spec.sources.some((source) => {
        return !source.name || !source.host || !Number.isInteger(source.port) || source.port < 1 || source.port > 65535;
    })) { throw new TypeError('Invalid silent source'); }
}
function descriptor(factory, keys, validate = () => { return undefined; }, resources = () => { return []; }) {
    return { validate(spec) { required(spec, keys); urlOptions(spec); boundedOptions(spec); validateTelemetryPolicy(spec); validate(spec); }, resources,
        create(spec, context) { return task(factory, spec, context); } };
}
/** Portable consumers previously embedded in site HTTP processes; migrations remain external. */
export default function additionalAdapters() {
    return new Map([
        ['operation-sync', descriptor((spec, pool, context) => {
            return operationSyncIngest(spec.amqp, spec.queue, operationsFromPg(pool), { ...boundedOptions(spec), budget: context.budget });
        }, ['amqp', 'queue', 'postgres'])],
        ['amqp-pg-metrics', descriptor(metrics, ['amqp', 'queue', 'postgres'])],
        ['mqtt-pg-metrics', descriptor(mqttPostgres, ['mqtt', 'topic', 'postgres'])],
        ['silent-streams', descriptor(silent, ['amqp', 'queue', 'sources'], silentConfig, (spec) => {
            return [...new Set(spec.sources.map((source) => { return `modbus-tcp:${source.host}:${source.port}`; }))];
        })],
        ['stomp-ingest', descriptor(stomp, ['stomp', 'postgres', 'config'])]
    ]);
}
