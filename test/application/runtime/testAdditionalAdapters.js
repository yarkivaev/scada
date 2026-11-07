import pg from 'pg';
import stompit from 'stompit';
import assert from 'node:assert/strict';
import mqtt from 'mqtt';
import taskBudget from '../../../src/application/runtime/taskBudget.js';
import additionalAdapters from '../../../src/application/runtime/additionalAdapters.js';

describe('embedded stream adapters', function () {
    it('exposes portable operation, metrics, silent fallback and STOMP ingestion', function () {
        const adapters = additionalAdapters();
        assert.deepEqual([...adapters.keys()].sort(), ['amqp-pg-metrics', 'mqtt-pg-metrics', 'operation-sync', 'silent-streams', 'stomp-ingest']);
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

describe('MQTT PostgreSQL runtime adapter', function () {
    const spec = { mqtt: { $secret: 'mqtt' }, postgres: { $secret: 'pg' }, topic: 'measurements/#',
        options: { clientId: 'existing-session', sessionExpiryInterval: 7200, maxBytes: 4096 },
        limits: { maxBytes: 256, maxRecords: 1 } };
    it('validates URLs and bounded limits before opening IO', function () {
        const adapter = additionalAdapters().get('mqtt-pg-metrics');
        assert.ok(adapter, 'missing MQTT PostgreSQL descriptor');
        adapter.validate(spec);
        assert.throws(() => { adapter.validate({ ...spec, mqtt: 'https://broker' }); }, /URL/u);
        assert.throws(() => { adapter.validate({ ...spec, limits: { maxBytes: 0 } }); }, /positive/u);
    });
    it('writes decoded metrics before ACK, preserves session identity and closes its pool once', async function () {
        const original = { pool: pg.Pool, connect: mqtt.MqttClient.prototype.connect,
            end: mqtt.MqttClient.prototype.end };
        const transport = {};
        const budget = taskBudget({ maxBytes: 256, maxRecords: 1 });
        let connection;
        let release;
        let ended = 0;
        let acknowledged = false;
        const writes = [];
        pg.Pool = class {
            constructor(options) { connection = options.connectionString; }
            on() {}
            async query(sql, values) { writes.push({ sql, values }); await new Promise((resolve) => { release = resolve; }); }
            async end() { ended += 1; }
        };
        mqtt.MqttClient.prototype.connect = function () { transport.client = this; return this; };
        mqtt.MqttClient.prototype.end = function (force, options, done) { done?.(); return this; };
        const task = additionalAdapters().get('mqtt-pg-metrics')?.create(spec, { signal: new AbortController().signal, budget,
            secrets: { get(key) { return key === 'mqtt' ? 'mqtt://broker' : 'postgres://store/db'; } } });
        try {
            assert.ok(task, 'missing MQTT PostgreSQL task');
            await task.start();
            assert.equal(connection, 'postgres://store/db');
            assert.equal(transport.client.options.clientId, 'existing-session');
            assert.equal(transport.client.options.clean, false);
            assert.equal(transport.client.options.properties.sessionExpiryInterval, 7200);
            assert.equal(transport.client.options.properties.maximumPacketSize, 256);
            transport.client.handleMessage({ topic: 'measurements/current', payload: Buffer.from('{"ts":1234,"value":42}') }, (error) => {
                assert.equal(error, undefined); acknowledged = true;
            });
            await new Promise(setImmediate);
            assert.equal(acknowledged, false);
            assert.equal(budget.status().records, 1);
            const rejected = await new Promise((resolve) => {
                transport.client.handleMessage({ topic: 'measurements/current', payload: Buffer.from('43') }, resolve);
            });
            assert.match(rejected.message, /capacity/u);
            assert.equal(writes.length, 1);
            assert.match(writes[0].sql, /INSERT INTO metrics/u);
            assert.deepEqual(writes[0].values, [['measurements/current'], [new Date(1234)], [42]]);
            release();
            await new Promise(setImmediate);
            assert.equal(acknowledged, true);
            assert.deepEqual(budget.status(), { bytes: 0, records: 0 });
            await task.stop(); await task.stop();
            assert.equal(ended, 1);
        } finally {
            release?.(); await task?.stop();
            // Restore the process-wide IO substitute after all pending acceptance settles.
            // eslint-disable-next-line require-atomic-updates
            pg.Pool = original.pool;
            Object.assign(mqtt.MqttClient.prototype, { connect: original.connect, end: original.end });
        }
    });
});
