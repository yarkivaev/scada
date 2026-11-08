import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { GenericContainer, Wait } from 'testcontainers';
import amqp from 'amqplib';
import { createClient } from '@clickhouse/client';
import centralPolicy from '../../src/infrastructure/ingest/telemetry/centralPolicy.js';
import centralMetricsPg from '../../src/infrastructure/persistence/pg/centralMetrics.js';
import canonicalMetrics from '../../src/infrastructure/persistence/clickhouse/canonicalMetrics.js';
import metricsRelation from '../../src/infrastructure/persistence/clickhouse/metricsRelation.js';
import clickhouseConnection from '../../src/infrastructure/persistence/clickhouse/connection.js';
import centralMetricsSink from '../../src/infrastructure/ingest/telemetry/centralMetricsSink.js';
import centralTelemetryPreflight from '../../src/infrastructure/ingest/telemetry/centralTelemetryPreflight.js';
import amqpMetricsIngest from '../../src/infrastructure/ingest/telemetry/amqpMetricsIngest.js';
import siteSyncTargets from '../../src/application/sync/siteSyncTargets.js';
/* eslint-disable no-await-in-loop */

describe('Durable central telemetry PostgreSQL / ClickHouse', function() {
    this.timeout(180000);
    let postgres;
    let clickhouse;
    let rabbit;
    let admin;
    let pool;
    let client;
    let url;
    const policy = centralPolicy({ enabled: true, topics: [{ topic: 'thin', thinWindowMs: 1000 }] });
    before(async function() {
        [postgres, clickhouse, rabbit] = await Promise.all([
            new GenericContainer('postgres:16-alpine').withEnvironment({ POSTGRES_PASSWORD: 'test' }).withExposedPorts(5432).start(),
            new GenericContainer('clickhouse/clickhouse-server:24').withExposedPorts(8123).start(),
            new GenericContainer('rabbitmq:3.13-management').withEnvironment({ RABBITMQ_DEFAULT_USER: 'test', RABBITMQ_DEFAULT_PASS: 'test', RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS: '+S 2:2 +A 2' })
                .withExposedPorts(5672).withWaitStrategy(Wait.forListeningPorts()).start()
        ]);
        admin = new pg.Pool({ host: postgres.getHost(), port: postgres.getMappedPort(5432), user: 'postgres', password: 'test' });
        await admin.query("CREATE ROLE supervisor_sink LOGIN PASSWORD 'test'");
        await admin.query(await readFile(new URL('../../db/migrations/C0008__central_telemetry.sql', import.meta.url), 'utf8'));
        await admin.query(await readFile(new URL('../../db/migrations/C0009__central_telemetry_grants.sql', import.meta.url), 'utf8'));
        pool = new pg.Pool({ host: postgres.getHost(), port: postgres.getMappedPort(5432), user: 'supervisor_sink', password: 'test', database: 'postgres' });
        url = `http://${clickhouse.getHost()}:${clickhouse.getMappedPort(8123)}`;
        client = createClient({ url });
        await client.command({ query: 'CREATE DATABASE scada' });
        await client.command({ query: 'CREATE TABLE scada.metrics(topic String,ts DateTime64(3),value Float64) ENGINE=MergeTree ORDER BY(topic,ts)' });
    });
    after(async function() {
        await Promise.allSettled([pool?.end(), admin?.end(), client?.close()]);
        await Promise.allSettled([postgres?.stop(), clickhouse?.stop(), rabbit?.stop()]);
    });
    async function count(table, topic) {
        return Number((await admin.query(`SELECT count(*) FROM ${table} WHERE topic=$1`, [topic])).rows[0].count);
    }
    async function rows(topic) {
        const response = await client.query({ query: `SELECT toUnixTimestamp64Milli(ts) AS ts,value FROM ${metricsRelation} WHERE topic={topic:String} ORDER BY ts`, query_params: { topic }, format: 'JSONEachRow' });
        return (await response.json()).map((row) => { return { ts: Number(row.ts), value: row.value }; });
    }
    it('lets read-only consumers upgrade before additive schema installation and discover new rows later', async function() {
        await client.command({ query: "CREATE USER reader IDENTIFIED BY 'test'" });
        await client.command({ query: 'GRANT SELECT ON scada.* TO reader' });
        const connection = await clickhouseConnection(clickhouse.getHost(), { port: clickhouse.getMappedPort(8123), username: 'reader', password: 'test' });
        assert.deepEqual(await connection.query('SELECT * FROM scada.metrics_read'), []);
        const projection = canonicalMetrics(url);
        await projection.write([{ topic: 'upgrade', ts: 0, value: 1 }]);
        assert.equal((await connection.query('SELECT value FROM scada.metrics_read')).length, 1);
        await projection.stop();
        await connection.close();
    });
    it('persists first-wins identity across receiver restarts and concurrent collectors', async function() {
        await centralMetricsPg(pool, policy).write([{ topic: 'exact', ts: 0, value: 7 }]);
        await Promise.all([1, 2, 3].map((value) => { return centralMetricsPg(pool, policy).write([{ topic: 'exact', ts: 0, value }]); }));
        assert.equal(await count('central_metric_receipts', 'exact'), 1);
        const projection = canonicalMetrics(url);
        await centralMetricsPg(pool, policy).project(projection);
        assert.deepEqual(await rows('exact'), [{ ts: 0, value: 7 }]);
        await projection.stop();
    });
    it('remembers thinned receipts and bucket choices across restarts and policy changes', async function() {
        await centralMetricsPg(pool, policy).write([{ topic: 'thin', ts: 1800, value: 1 }, { topic: 'thin', ts: 1100, value: 2 }, { topic: 'thin', ts: 2000, value: 3 }]);
        await centralMetricsPg(pool, policy).write([{ topic: 'thin', ts: 1900, value: 4 }]);
        await centralMetricsPg(pool, centralPolicy({ enabled: true })).write([{ topic: 'thin', ts: 1100, value: 5 }]);
        const projection = canonicalMetrics(url);
        await centralMetricsPg(pool, policy).project(projection);
        assert.deepEqual(await rows('thin'), [{ ts: 1800, value: 1 }, { ts: 2000, value: 3 }]);
        assert.equal(await count('central_metric_receipts', 'thin'), 4);
        await projection.stop();
    });
    it('retries an ambiguous committed ClickHouse write without visible duplicates', async function() {
        await centralMetricsPg(pool, policy).write([{ topic: 'lost-response', ts: 1000, value: 4 }]);
        const projection = canonicalMetrics(url);
        await assert.rejects(centralMetricsPg(pool, policy).project({ async write(records) { await projection.write(records); throw new Error('lost reply'); } }), /lost reply/u);
        assert.equal(await count('central_metric_outbox', 'lost-response'), 1);
        await centralMetricsPg(pool, policy).project(projection);
        assert.deepEqual(await rows('lost-response'), [{ ts: 1000, value: 4 }]);
        assert.equal(await count('central_metric_outbox', 'lost-response'), 0);
        assert.equal(await count('central_metric_receipts', 'lost-response'), 1);
        await projection.stop();
    });
    it('preserves old MergeTree data and chooses legacy on overlapping timestamps', async function() {
        await client.insert({ table: 'scada.metrics', values: [{ topic: 'legacy', ts: '1970-01-01 00:00:01.000', value: 8 }], format: 'JSONEachRow' });
        const projection = canonicalMetrics(url);
        await projection.write([{ topic: 'legacy', ts: 1000, value: 9 }, { topic: 'legacy', ts: 2000, value: 10 }]);
        assert.deepEqual(await rows('legacy'), [{ ts: 1000, value: 8 }, { ts: 2000, value: 10 }]);
        await projection.stop();
    });
    it('rolls back incoming batches on capacity overflow without losing existing pending data', async function() {
        const bounded = centralPolicy({ enabled: true, maxPendingRecords: 1 });
        const store = centralMetricsPg(pool, bounded);
        await store.write([{ topic: 'full', ts: 1000, value: 1 }]);
        await assert.rejects(store.write([{ topic: 'full', ts: 2000, value: 2 }]), /capacity/u);
        assert.equal(await count('central_metric_outbox', 'full'), 1);
        assert.equal(await count('central_metric_receipts', 'full'), 1);
        const projection = canonicalMetrics(url);
        await store.project(projection);
        await projection.stop();
    });
    it('resumes a saved outbox without any new delivery after restart', async function() {
        await centralMetricsPg(pool, policy).write([{ topic: 'restart', ts: 1000, value: 4 }]);
        const restarted = centralMetricsSink({ CLICKHOUSE_URL: url, CENTRAL_TELEMETRY_POLICY: JSON.stringify({ enabled: true, flushIntervalMs: 20 }) }, pool);
        const end = Date.now() + 5000;
        while (await count('central_metric_outbox', 'restart')) {
            assert.ok(Date.now() < end, 'startup projector did not drain existing work');
            await new Promise((resolve) => { setTimeout(resolve, 20); });
        }
        assert.deepEqual(await rows('restart'), [{ ts: 1000, value: 4 }]);
        await restarted.stop();
    });
    it('fails closed when disabling a previously activated policy', async function() {
        await assert.rejects(centralTelemetryPreflight({ CENTRAL_TELEMETRY_POLICY: '{"enabled":false}' }, pool), /cannot be disabled/u);
        await assert.rejects(centralTelemetryPreflight({}, pool), /cannot be disabled/u);
    });
    it('preserves exact millisecond timestamps at supported ClickHouse limits', async function() {
        const projection = canonicalMetrics(url);
        const points = [-2208988800000, 10413791999999].map((ts) => { return { topic: 'limits', ts, value: 1 }; });
        await centralMetricsPg(pool, policy).write(points);
        await centralMetricsPg(pool, policy).project(projection);
        assert.deepEqual(await rows('limits'), points.map(({ ts, value }) => { return { ts, value }; }));
        assert.throws(() => { centralMetricsPg(pool, policy).write([{ topic: 'limits', ts: Number.MAX_SAFE_INTEGER, value: 1 }]); }, /timestamp/u);
        assert.equal(await count('central_metric_receipts', 'limits'), 2);
        await projection.stop();
    });
    it('rejects an incompatible pre-existing projection without discarding pending observations', async function() {
        await centralMetricsPg(pool, policy).write([{ topic: 'bad-schema', ts: 1000, value: 1 }]);
        await client.command({ query: 'RENAME TABLE scada.metrics_canonical TO scada.metrics_saved' });
        await client.command({ query: 'CREATE TABLE scada.metrics_canonical(topic String,ts DateTime64(0),value Float64) ENGINE=ReplacingMergeTree ORDER BY(topic,ts)' });
        const incompatible = canonicalMetrics(url);
        await assert.rejects(centralMetricsPg(pool, policy).project(incompatible), /Incompatible.*columns/u);
        assert.equal(await count('central_metric_outbox', 'bad-schema'), 1);
        await incompatible.stop();
        await client.command({ query: 'DROP TABLE scada.metrics_canonical' });
        await client.command({ query: 'RENAME TABLE scada.metrics_saved TO scada.metrics_canonical' });
        const recovered = canonicalMetrics(url);
        await centralMetricsPg(pool, policy).project(recovered);
        assert.deepEqual(await rows('bad-schema'), [{ ts: 1000, value: 1 }]);
        await recovered.stop();
    });
    it('deduplicates real broker delivery after consumer restart and acknowledges only durable acceptance', async function() {
        const address = `amqp://test:test@${rabbit.getHost()}:${rabbit.getMappedPort(5672)}`;
        const connection = await amqp.connect(address);
        const channel = await connection.createConfirmChannel();
        await channel.assertExchange('scada.telemetry', 'topic', { durable: true });
        const queue = 'central.dedup.test';
        await channel.assertQueue(queue, { durable: true });
        await channel.bindQueue(queue, 'scada.telemetry', 'broker.exact');
        let seen = 0;
        let receiver;
        async function publish(value) {
            channel.publish('scada.telemetry', 'broker.exact', Buffer.from(JSON.stringify({ ts: 1000, value })), { persistent: true });
            await channel.waitForConfirms();
        }
        async function awaitSeen(expected) {
            const end = Date.now() + 5000;
            // The broker callback changes seen after the PostgreSQL transaction.
            // eslint-disable-next-line no-unmodified-loop-condition
            while (seen < expected) {
                assert.ok(Date.now() < end, 'broker delivery not committed');
                await new Promise((resolve) => { setTimeout(resolve, 20); });
            }
        }
        function consumer() {
            const store = centralMetricsPg(pool, policy);
            return amqpMetricsIngest(address, queue, { requireTimestamp: true, write(points) { return store.write(points); } }, {
                size: 1, interval: 0.01, onSeen() { seen += 1; }
            });
        }
        try {
            receiver = consumer(); await receiver.start();
            await publish(11); await awaitSeen(1);
            await receiver.stop(); receiver = null;
            assert.equal((await channel.checkQueue(queue)).messageCount, 0);
            assert.equal(await count('central_metric_outbox', 'broker/exact'), 1);
            const projection = canonicalMetrics(url);
            await centralMetricsPg(pool, policy).project(projection);
            await projection.stop();
            receiver = consumer(); await receiver.start();
            await publish(99); await awaitSeen(2);
            await receiver.stop(); receiver = null;
            assert.equal((await channel.checkQueue(queue)).messageCount, 0);
            assert.equal(await count('central_metric_outbox', 'broker/exact'), 0);
            assert.deepEqual(await rows('broker/exact'), [{ ts: 1000, value: 11 }]);
        } finally { await receiver?.stop(); await channel.close(); await connection.close(); }
    });
    it('applies the same durable policy to exported measurements synchronized over the site API', async function() {
        const sink = centralMetricsSink({ CLICKHOUSE_URL: url, CENTRAL_TELEMETRY_POLICY: '{"enabled":true,"flushIntervalMs":20}' }, pool);
        const target = siteSyncTargets({ metrics: sink, topic() { return 'sync-exact'; } }).measurements;
        function body(value) { return { items: [{ key: 'temp', values: [{ timestamp: '1970-01-01T00:00:01.000Z', value }] }] }; }
        try {
            await target.write('machine', body(1));
            await target.write('machine', body(99));
            const end = Date.now() + 5000;
            while (await count('central_metric_outbox', 'sync-exact')) {
                assert.ok(Date.now() < end, 'sync outbox not projected');
                await new Promise((resolve) => { setTimeout(resolve, 20); });
            }
            assert.deepEqual(await rows('sync-exact'), [{ ts: 1000, value: 1 }]);
        } finally { await sink.stop(); }
    });
});
