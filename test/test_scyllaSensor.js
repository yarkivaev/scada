import assert from 'assert';
import { GenericContainer } from 'testcontainers';
import { Client } from 'cassandra-driver';
import scyllaSensor from '../src/scyllaSensor.js';

function connection(client) {
    return {
        async query(cql, params) {
            const result = await client.execute(cql, params, { prepare: true });
            return result.rows;
        }
    };
}

describe('scyllaSensor', function() {
    let container;
    let client;
    let conn;

    before(async function() {
        this.timeout(120000);
        container = await new GenericContainer('scylladb/scylla:5.4')
            .withExposedPorts(9042)
            .withCommand(['--smp', '1', '--memory', '512M', '--developer-mode', '1'])
            .withStartupTimeout(90000)
            .start();
        const host = container.getHost();
        const port = container.getMappedPort(9042);
        client = new Client({
            contactPoints: [`${host}:${port}`],
            localDataCenter: 'datacenter1'
        });
        let retries = 30;
        while (retries > 0) {
            try {
                // eslint-disable-next-line no-await-in-loop
                await client.connect();
                break;
            } catch {
                retries -= 1;
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => {
                    setTimeout(resolve, 2000);
                });
            }
        }
        await client.execute(`
            CREATE KEYSPACE IF NOT EXISTS scada
            WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}
        `);
        await client.execute(`
            CREATE TABLE IF NOT EXISTS scada.metrics (
                topic text,
                ts timestamp,
                value double,
                PRIMARY KEY ((topic), ts)
            ) WITH CLUSTERING ORDER BY (ts DESC)
        `);
        conn = connection(client);
    });

    after(async function() {
        this.timeout(30000);
        if (client) {
            await client.shutdown();
        }
        if (container) {
            await container.stop();
        }
    });

    it('returns display name when name is called', function() {
        const topic = `topic${Math.random()}`;
        const name = `Voltage${Math.random()}`;
        const unit = `V${Math.random()}`;
        const sensor = scyllaSensor(conn, topic, name, unit);
        assert(sensor.name() === name, 'name mismatch');
    });

    it('returns empty array when no measurements exist', async function() {
        const topic = `topic${Math.random()}`;
        const name = `name${Math.random()}`;
        const unit = `unit${Math.random()}`;
        const sensor = scyllaSensor(conn, topic, name, unit);
        const now = new Date();
        const result = await sensor.measurements({
            start: new Date(now.getTime() - 1000),
            end: new Date(now.getTime() + 1000)
        });
        assert(result.length === 0, 'expected empty array');
    });

    it('returns measurements within time range', async function() {
        const topic = `topic${Math.random()}`;
        const name = `name${Math.random()}`;
        const unit = `unit${Math.random()}`;
        const now = new Date();
        const value = Math.random() * 100;
        await client.execute(
            'INSERT INTO scada.metrics (topic, ts, value) VALUES (?, ?, ?)',
            [topic, now, value],
            { prepare: true }
        );
        const sensor = scyllaSensor(conn, topic, name, unit);
        const result = await sensor.measurements({
            start: new Date(now.getTime() - 1000),
            end: new Date(now.getTime() + 1000)
        });
        assert(result.length === 1, 'expected one measurement');
    });

    it('excludes measurements outside time range', async function() {
        const topic = `topic${Math.random()}`;
        const name = `name${Math.random()}`;
        const unit = `unit${Math.random()}`;
        const now = new Date();
        const past = new Date(now.getTime() - 10000);
        const value = Math.random() * 100;
        await client.execute(
            'INSERT INTO scada.metrics (topic, ts, value) VALUES (?, ?, ?)',
            [topic, past, value],
            { prepare: true }
        );
        const sensor = scyllaSensor(conn, topic, name, unit);
        const result = await sensor.measurements({
            start: new Date(now.getTime() - 1000),
            end: new Date(now.getTime() + 1000)
        });
        assert(result.length === 0, 'expected no measurements in range');
    });

    it('returns measurements with correct unit', async function() {
        const topic = `topic${Math.random()}`;
        const name = `name${Math.random()}`;
        const unit = `cos(φ)${Math.random()}`;
        const now = new Date();
        const value = Math.random() * 100;
        await client.execute(
            'INSERT INTO scada.metrics (topic, ts, value) VALUES (?, ?, ?)',
            [topic, now, value],
            { prepare: true }
        );
        const sensor = scyllaSensor(conn, topic, name, unit);
        const result = await sensor.measurements({
            start: new Date(now.getTime() - 1000),
            end: new Date(now.getTime() + 1000)
        });
        assert(result[0].unit === unit, 'unit mismatch');
    });

    it('streams new measurements to callback', async function() {
        this.timeout(5000);
        const topic = `topic${Math.random()}`;
        const name = `name${Math.random()}`;
        const unit = `unit${Math.random()}`;
        const now = new Date();
        const value = Math.random() * 100;
        await client.execute(
            'INSERT INTO scada.metrics (topic, ts, value) VALUES (?, ?, ?)',
            [topic, now, value],
            { prepare: true }
        );
        const sensor = scyllaSensor(conn, topic, name, unit);
        const since = new Date(now.getTime() - 1000);
        let received = null;
        const subscription = sensor.stream(since, 100, (measurement) => {
            received = measurement;
        });
        await new Promise((resolve) => {
            setTimeout(resolve, 500);
        });
        subscription.cancel();
        assert(received !== null && received.value === value, 'callback was not called with correct value');
    });

    it('cancels streaming when cancel is called', async function() {
        this.timeout(5000);
        const topic = `topic${Math.random()}`;
        const name = `name${Math.random()}`;
        const unit = `unit${Math.random()}`;
        const sensor = scyllaSensor(conn, topic, name, unit);
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
