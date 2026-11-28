import assert from 'node:assert/strict';
import { createClient } from '@clickhouse/client';
import pg from 'pg';
import { GenericContainer, Wait } from 'testcontainers';
import { clickhouseTelemetryTarget, postgresTelemetrySource, telemetryBackfill } from '@yarkivaev/scada';

const first = '2026-11-08 01:02:03.123456';
const last = '2026-11-08 01:02:03.123457';

describe('telemetry backfill storage adapters', function () {
    this.timeout(120000);
    let postgres;
    let clickhouse;
    let client;
    let pool;

    before(async function () {
        postgres = await new GenericContainer('postgres:16-alpine').withExposedPorts(5432)
            .withEnvironment({ POSTGRES_PASSWORD: 'fixture' })
            .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2)).start();
        pool = new pg.Pool({ connectionString: `postgresql://postgres:fixture@${postgres.getHost()}:${postgres.getMappedPort(5432)}/postgres` });
        await pool.query('CREATE TABLE metrics(topic text, ts timestamptz, value float8)');
        await pool.query('INSERT INTO metrics VALUES ($1, $2, 7), ($1, $2, 8), ($1, $2, 7), ($1, $3, 9)',
            ['unit/measurement', `${first}+00`, `${last}+00`]);
        clickhouse = await new GenericContainer('clickhouse/clickhouse-server:24').withExposedPorts(8123)
            .withWaitStrategy(Wait.forHttp('/ping', 8123)).start();
        client = createClient({ url: `http://${clickhouse.getHost()}:${clickhouse.getMappedPort(8123)}` });
        await client.command({ query: 'CREATE DATABASE scada' });
        await client.command({
            query: "CREATE TABLE scada.metrics (topic String, ts DateTime64(6,'UTC'), value Float64) ENGINE=MergeTree ORDER BY (topic,ts)"
        });
    });

    after(async function () {
        await Promise.allSettled([client?.close(), pool?.end()]);
        await Promise.allSettled([clickhouse?.stop(), postgres?.stop()]);
    });

    it('copies and verifies exact microseconds, duplicate rows and distinct values with page size one', async function () {
        const source = postgresTelemetrySource(pool);
        const target = clickhouseTelemetryTarget(client);
        try {
            const copied = await telemetryBackfill({ source, target }, { pageSize: 1 });
            const verified = await telemetryBackfill({ source, target }, { pageSize: 1, mode: 'verify' });
            assert.equal(copied.sourceCount, 4);
            assert.equal(verified.digest, copied.digest);
            const result = await client.query({
                query: 'SELECT toString(ts) AS timestamp, value FROM scada.metrics ORDER BY ts,value',
                format: 'JSONEachRow'
            });
            assert.deepEqual(await result.json(), [
                { timestamp: first, value: 7 }, { timestamp: first, value: 7 },
                { timestamp: first, value: 8 }, { timestamp: last, value: 9 }
            ]);
        } finally {
            await source.close();
        }
    });
});
