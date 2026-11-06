import pg from 'pg';
import stompit from 'stompit';
import assert from 'node:assert/strict';
import additionalAdapters from '../../../src/application/runtime/additionalAdapters.js';

describe('embedded stream adapters', function () {
    it('exposes portable operation, metrics, silent fallback and STOMP ingestion', function () {
        const adapters = additionalAdapters();
        assert.deepEqual([...adapters.keys()].sort(), ['amqp-pg-metrics', 'operation-sync', 'silent-streams', 'stomp-ingest']);
        for (const descriptor of adapters.values()) {
            assert.throws(() => { descriptor.validate({}); }, /Missing/u);
        }
    });
    it('validates silent fallback configuration and claims each device resource', function () {
        const descriptor = additionalAdapters().get('silent-streams');
        const spec = { amqp: { $secret: 'broker' }, queue: 'metrics', clickhouse: 'http://db:8123',
            budget: 15, interval: 5, sources: [{ name: 'sensor', host: '192.0.2.1', port: 502 }] };
        descriptor.validate(spec);
        assert.deepEqual(descriptor.resources(spec), ['modbus-tcp:192.0.2.1:502']);
        assert.throws(() => { descriptor.validate({ ...spec, budget: 0 }); }, /positive/u);
        assert.throws(() => { descriptor.validate({ ...spec, sources: [{ name: 'sensor' }] }); }, /source/u);
    });
    it('rejects invalid transport URLs before opening resources', function () {
        const adapter = additionalAdapters().get('operation-sync');
        assert.throws(() => { adapter.validate({ amqp: 'https://wrong', postgres: 'postgres://localhost/db', queue: 'ops' }); }, /URL/u);
    });
    it('can stop before opening any source or PostgreSQL connection', async function () {
        const descriptor = additionalAdapters().get('operation-sync');
        const task = descriptor.create({ amqp: 'amqp://localhost', postgres: 'postgres://localhost/db', queue: 'operations' },
            { signal: new AbortController().signal });
        await task.stop();
        await assert.rejects(task.start(), /stopped/u);
    });
});

it('propagates a terminal STOMP subscription error from the portable adapter', async () => {
    const originalPool = pg.Pool; const originalChannel = stompit.Channel; const received = []; const reports = [];
    pg.Pool = function Pool() { return { on() {}, query() { return Promise.resolve({ rows: [] }); }, end() { return Promise.resolve(); } }; };
    stompit.Channel = function Channel() { return { subscribe(_headers, callback) { received.push(callback); }, close() {} }; };
    const task = additionalAdapters().get('stomp-ingest').create({ stomp: 'stomp://test', postgres: 'postgres://unused', config: {} },
        { signal: new AbortController().signal, report(event) { reports.push(event); } });
    try {
        await task.start();
        received[0](new Error('subscription rejected'));
        assert(reports.some(event => {return event.state === 'failed' && event.fatal === true}));
        await assert.rejects(task.stop(), /subscription rejected/u);
    } finally {
        // Restore synchronous dependency boundaries after lifecycle cleanup.
        // eslint-disable-next-line require-atomic-updates
        pg.Pool = originalPool;
        // eslint-disable-next-line require-atomic-updates
        stompit.Channel = originalChannel;
    }
});
