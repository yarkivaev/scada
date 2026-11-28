import { createServer } from 'node:http';
import { createClient } from '@clickhouse/client';
import { openPostgresPool as openPool } from '../../persistence/postgresPool.js';
import metricsState from '../../persistence/clickhouse/metricsState.js';
import historyMetrics from './historyTelemetryMetrics.js';

function responseFor(inputs, path, response) {
    if (!['/live', '/ready', '/status'].includes(path)) {
        response.writeHead(404).end();
        return;
    }
    const queues = inputs.map((input) => { return input.status(); });
    const ready = queues.every((state) => { return state.ready; });
    const live = queues.every((state) => { return state.live; });
    const status = { ...queues[0], ready, live, queues };
    const unhealthy = (path === '/ready' && !ready) || (path === '/live' && !live);
    response.writeHead(unhealthy ? 503 : 200, { 'content-type': 'application/json' }).end(JSON.stringify(status));
}

async function schemaReady(client) {
    const result = await client.query({
        query: "SELECT count() AS n FROM system.tables WHERE database='scada' AND name='metrics'",
        format: 'JSONEachRow'
    });
    if (Number((await result.json())[0]?.n) !== 1) {
        throw new Error('ClickHouse telemetry schema is not initialized');
    }
}

function serve(inputs, resources, { port, host }) {
    const server = createServer((req, res) => { responseFor(inputs, req.url, res); });
    let stopping;
    function stop() {
        stopping ??= Promise.allSettled(inputs.map((input) => { return input.stop(); })).then(async (settled) => {
            const closed = await Promise.allSettled(resources.map((close) => { return close(); }));
            server.close();
            const failure = [...settled, ...closed].find((result) => { return result.status === 'rejected'; });
            if (failure) { throw failure.reason; }
        });
        return stopping;
    }
    function onSignal() {
        void stop().catch((error) => {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
        });
    }
    const signals = ['SIGINT', 'SIGTERM'];
    signals.forEach((signal) => { process.once(signal, onSignal); });
    server.once('close', () => { signals.forEach((signal) => { process.off(signal, onSignal); }); });
    server.listen(port, host);
    return stop;
}

function sinks(client, spec) {
    const base = metricsState(client);
    const pool = spec.history ? openPool(spec.postgres) : undefined;
    const history = spec.history?.(client, pool);
    return { pool, history, metrics: history ? historyMetrics(base, history) : base };
}

/** Opens the local ClickHouse ingest queues and their shared readiness endpoint. */
export default async function edgeTelemetryRuntime(spec) {
    const { clickhouse, queues, broker, createInput, inputOptions, port = 9093, host = '0.0.0.0' } = spec;
    if (!queues.length || queues.some((queue) => { return typeof queue !== 'string' || !queue; }) ||
        new Set(queues).size !== queues.length) {
        throw new Error('Distinct telemetry queue names required');
    }
    const client = createClient({ 'request_timeout': 40000, 'max_open_connections': 2,
        'clickhouse_settings': { 'async_insert': 0, 'insert_deduplicate': 1 }, ...clickhouse });
    const { pool, history, metrics } = sinks(client, spec);
    const inputs = queues.map((queue) => { return createInput(broker, queue, metrics, inputOptions); });
    const stop = serve(inputs, [() => { return client.close(); }, () => { return pool?.end(); }], { port, host });
    try {
        await schemaReady(client);
        await history?.ready();
        await Promise.all(inputs.map((input) => { return input.start(); }));
    } catch (error) {
        await stop().catch(() => { return undefined; });
        throw error;
    }
    return { stop };
}
