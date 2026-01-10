import assert from 'assert';
import { GenericContainer } from 'testcontainers';
import { createClient } from '@clickhouse/client';
import clickhouseSensor from '../src/clickhouseSensor.js';

function connection(client) {
    return {
        async query(sql, params = {}) {
            const result = await client.query({
                query: sql,
                query_params: params,
                format: 'JSONEachRow'
            });
            return result.json();
        }
    };
}

describe('clickhouseSensor', function() {
    let container;
    let client;
    let conn;

    before(async function() {
        this.timeout(120000);
        container = await new GenericContainer('clickhouse/clickhouse-server:24')
            .withExposedPorts(8123)
            .withStartupTimeout(60000)
            .start();
        const host = container.getHost();
        const port = container.getMappedPort(8123);
        client = createClient({ url: `http://${host}:${port}` });
        let retries = 30;
        while (retries > 0) {
            try {
                // eslint-disable-next-line no-await-in-loop
                await client.query({ query: 'SELECT 1', format: 'JSON' });
                break;
            } catch {
                retries -= 1;
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => {
                    setTimeout(resolve, 1000);
                });
            }
        }
        await client.command({ query: 'CREATE DATABASE IF NOT EXISTS scada' });
        await client.command({
            query: `CREATE TABLE IF NOT EXISTS scada.metrics (
                topic String,
                ts DateTime64(3),
                value Float64
            ) ENGINE = MergeTree() ORDER BY (topic, ts)`
        });
        conn = connection(client);
    });

    after(async function() {
        this.timeout(30000);
        if (client) {
            await client.close();
        }
        if (container) {
            await container.stop();
        }
    });

    it('returns display name when name is called', function() {
        const topic = `topic${Math.random()}`;
        const name = `Voltage${Math.random()}`;
        const unit = `V${Math.random()}`;
        const sensor = clickhouseSensor(conn, topic, name, unit);
        assert(sensor.name() === name, 'name mismatch');
    });

    it('returns empty array when no measurements exist', async function() {
        const topic = `topic${Math.random()}`;
        const name = `name${Math.random()}`;
        const unit = `unit${Math.random()}`;
        const sensor = clickhouseSensor(conn, topic, name, unit);
        const now = new Date();
        const result = await sensor.measurements({
            start: new Date(now.getTime() - 1000),
            end: new Date(now.getTime() + 1000)
        }, 1000);
        assert(result.length === 0, 'expected empty array');
    });

    it('returns measurements within time range', async function() {
        const topic = `topic${Math.random()}`;
        const name = `name${Math.random()}`;
        const unit = `unit${Math.random()}`;
        const now = new Date();
        const value = Math.random() * 100;
        await client.insert({
            table: 'scada.metrics',
            values: [{ topic, ts: now.getTime(), value }],
            format: 'JSONEachRow'
        });
        const sensor = clickhouseSensor(conn, topic, name, unit);
        const result = await sensor.measurements({
            start: new Date(now.getTime() - 10000),
            end: new Date(now.getTime() + 10000)
        }, 1000);
        assert(result.length >= 1, 'expected at least one measurement');
    });

    it('returns measurements with correct value', async function() {
        const topic = `topic${Math.random()}`;
        const name = `name${Math.random()}`;
        const unit = `unit${Math.random()}`;
        const now = new Date();
        const value = Math.random() * 100;
        await client.insert({
            table: 'scada.metrics',
            values: [{ topic, ts: now.getTime(), value }],
            format: 'JSONEachRow'
        });
        const sensor = clickhouseSensor(conn, topic, name, unit);
        const result = await sensor.measurements({
            start: new Date(now.getTime() - 10000),
            end: new Date(now.getTime() + 10000)
        }, 1000);
        assert(Math.abs(result[0].value - value) < 0.001, 'value mismatch');
    });

    it('returns measurements with correct unit', async function() {
        const topic = `topic${Math.random()}`;
        const name = `name${Math.random()}`;
        const unit = `cos(φ)${Math.random()}`;
        const now = new Date();
        const value = Math.random() * 100;
        await client.insert({
            table: 'scada.metrics',
            values: [{ topic, ts: now.getTime(), value }],
            format: 'JSONEachRow'
        });
        const sensor = clickhouseSensor(conn, topic, name, unit);
        const result = await sensor.measurements({
            start: new Date(now.getTime() - 10000),
            end: new Date(now.getTime() + 10000)
        }, 1000);
        assert(result[0].unit === unit, 'unit mismatch');
    });

    it('streams new measurements to callback', async function() {
        this.timeout(5000);
        const topic = `topic${Math.random()}`;
        const name = `name${Math.random()}`;
        const unit = `unit${Math.random()}`;
        const now = new Date();
        const value = Math.random() * 100;
        await client.insert({
            table: 'scada.metrics',
            values: [{ topic, ts: now.getTime(), value }],
            format: 'JSONEachRow'
        });
        const sensor = clickhouseSensor(conn, topic, name, unit);
        const since = new Date(now.getTime() - 1000);
        let received = null;
        const subscription = sensor.stream(since, 100, (measurement) => {
            received = measurement;
        });
        await new Promise((resolve) => {
            setTimeout(resolve, 500);
        });
        subscription.cancel();
        assert(received !== null && Math.abs(received.value - value) < 0.001, 'callback was not called with correct value');
    });

    it('cancels streaming when cancel is called', async function() {
        this.timeout(5000);
        const topic = `topic${Math.random()}`;
        const name = `name${Math.random()}`;
        const unit = `unit${Math.random()}`;
        const sensor = clickhouseSensor(conn, topic, name, unit);
        const since = new Date();
        let count = 0;
        const subscription = sensor.stream(since, 50, () => {
            count += 1;
        });
        subscription.cancel();
        const before = count;
        await new Promise((resolve) => {
            setTimeout(resolve, 200);
        });
        assert(count === before, 'callback was called after cancel');
    });
});
