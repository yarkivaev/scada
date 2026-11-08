import { clickhouseSink } from '../../streams/index.js';
import centralPolicy from './centralPolicy.js';
import centralMetricsPg from '../../persistence/pg/centralMetrics.js';
import canonicalMetrics from '../../persistence/clickhouse/canonicalMetrics.js';
import centralTelemetryPreflight from './centralTelemetryPreflight.js';
/* eslint-disable no-await-in-loop, require-atomic-updates */

async function flush(state) {
    try {
        let count;
        do { count = await state.store.project(state.projection); } while (count && !state.stopped);
        state.error = null;
    } catch (error) {
        if (state.error?.message !== error.message) { process.stderr.write(`[scada] central telemetry projection failed: ${error.message}\n`); }
        state.error = error;
    }
    finally { state.flushing = null; }
}
function kick(state) {
    state.flushing ??= flush(state);
    return state.flushing;
}

/** PG commit is the durable acceptance boundary; projection retries independently. */
export default function centralMetricsSink(env, pool) {
    const policy = centralPolicy(env.CENTRAL_TELEMETRY_POLICY ? JSON.parse(env.CENTRAL_TELEMETRY_POLICY) : {});
    const url = env.CLICKHOUSE_URL || (env.CLICKHOUSE_HOST ? `http://${env.CLICKHOUSE_HOST}:8123` : undefined);
    if (!policy.enabled) {
        const raw = clickhouseSink(url, 'scada.metrics');
        let checked;
        function start() { checked ??= centralTelemetryPreflight(env, pool); return checked; }
        return { start, async write(records, context) { await start(); return raw.write(records, context); }, stop() { return raw.stop(); } };
    }
    if (!pool || typeof pool.connect !== 'function') { throw new TypeError('Enabled central telemetry policy requires PostgreSQL'); }
    const state = { store: centralMetricsPg(pool, policy), projection: canonicalMetrics(url), stopped: false, flushing: null, error: null };
    const timer = setInterval(() => { kick(state); }, policy.flushIntervalMs);
    timer.unref?.();
    kick(state);
    return {
        requireTimestamp: true,
        async write(records) {
            if (state.stopped) { throw new Error('Central telemetry sink stopped'); }
            await state.store.write(records);
            kick(state);
        },
        status() { return { projecting: Boolean(state.flushing), error: state.error?.message ?? null }; },
        async stop() {
            state.stopped = true;
            clearInterval(timer);
            await state.flushing;
            await state.projection.stop();
        }
    };
}
