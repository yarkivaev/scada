import assert from 'assert';
import { GenericContainer } from 'testcontainers';
import pg from 'pg';
import postgresSensor from '../src/postgresSensor.js';

function connection(pool) {
    return {
        async query(sql, params = []) {
            const result = await pool.query(sql, params);
            return result.rows;
        }
    };
}

describe('postgresSensor', function() {
    let container;
    let pool;
    let conn;

    before(async function() {
        this.timeout(120000);
        container = await new GenericContainer('postgres:16-alpine')
            .withExposedPorts(5432)
            .withEnvironment({ POSTGRES_USER: 'scada', POSTGRES_PASSWORD: 'scada', POSTGRES_DB: 'scada' })
            .withStartupTimeout(60000)
            .start();
        const host = container.getHost();
        const port = container.getMappedPort(5432);
        pool = new pg.Pool({ connectionString: `postgresql://scada:scada@${host}:${port}/scada` });
        let retries = 30;
        while (retries > 0) {
            try {
                // eslint-disable-next-line no-await-in-loop
                await pool.query('SELECT 1');
                break;
            } catch {
                retries -= 1;
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => { setTimeout(resolve, 1000); });
            }
        }
        await pool.query(`CREATE TABLE IF NOT EXISTS metrics (
            topic TEXT NOT NULL,
            ts TIMESTAMPTZ NOT NULL,
            value DOUBLE PRECISION NOT NULL
        )`);
        await pool.query('CREATE INDEX IF NOT EXISTS idx_metrics_topic_ts ON metrics (topic, ts)');
        conn = connection(pool);
    });

    after(async function() {
        this.timeout(30000);
        if (pool) {
            await pool.end();
        }
        if (container) {
            await container.stop();
        }
    });

    it('returns display name when name is called', function() {
        const topic = `tøpic${Math.random()}`;
        const name = `Spännung${Math.random()}`;
        const unit = `V${Math.random()}`;
        const sensor = postgresSensor(conn, topic, name, unit);
        assert(sensor.name() === name, 'name mismatch');
    });

    it('returns empty array when no measurements exist', async function() {
        const topic = `tøpic${Math.random()}`;
        const sensor = postgresSensor(conn, topic, `name${Math.random()}`, 'V');
        const now = new Date();
        const result = await sensor.measurements({
            start: new Date(now.getTime() - 1000),
            end: new Date(now.getTime() + 1000)
        }, 1000);
        assert(result.length === 0, 'expected empty array');
    });

    it('returns measurements within time range', async function() {
        const topic = `tøpic${Math.random()}`;
        const now = new Date();
        const value = Math.random() * 100;
        await pool.query('INSERT INTO metrics (topic, ts, value) VALUES ($1, $2, $3)', [topic, now, value]);
        const sensor = postgresSensor(conn, topic, `name${Math.random()}`, 'V');
        const result = await sensor.measurements({
            start: new Date(now.getTime() - 10000),
            end: new Date(now.getTime() + 10000)
        }, 1000);
        assert(result.length >= 1, 'expected at least one measurement');
    });

    it('returns measurements with correct value', async function() {
        const topic = `tøpic${Math.random()}`;
        const now = new Date();
        const value = Math.random() * 100;
        await pool.query('INSERT INTO metrics (topic, ts, value) VALUES ($1, $2, $3)', [topic, now, value]);
        const sensor = postgresSensor(conn, topic, `name${Math.random()}`, 'V');
        const result = await sensor.measurements({
            start: new Date(now.getTime() - 10000),
            end: new Date(now.getTime() + 10000)
        }, 1000);
        assert(Math.abs(result[0].value - value) < 0.001, 'value mismatch');
    });

    it('returns measurements with correct unit', async function() {
        const topic = `tøpic${Math.random()}`;
        const unit = `cos(φ)${Math.random()}`;
        const now = new Date();
        await pool.query('INSERT INTO metrics (topic, ts, value) VALUES ($1, $2, $3)', [topic, now, Math.random()]);
        const sensor = postgresSensor(conn, topic, `name${Math.random()}`, unit);
        const result = await sensor.measurements({
            start: new Date(now.getTime() - 10000),
            end: new Date(now.getTime() + 10000)
        }, 1000);
        assert(result[0].unit === unit, 'unit mismatch');
    });

    it('streams new measurements to callback', async function() {
        this.timeout(5000);
        const topic = `tøpic${Math.random()}`;
        const now = new Date();
        const value = Math.random() * 100;
        await pool.query('INSERT INTO metrics (topic, ts, value) VALUES ($1, $2, $3)', [topic, now, value]);
        const sensor = postgresSensor(conn, topic, `name${Math.random()}`, 'V');
        const since = new Date(now.getTime() - 1000);
        let received = null;
        const subscription = sensor.stream(since, 100, (measurement) => {
            received = measurement;
        });
        await new Promise((resolve) => { setTimeout(resolve, 500); });
        subscription.cancel();
        assert(received !== null && Math.abs(received.value - value) < 0.001, 'callback was not called with correct value');
    });

    it('cancels streaming when cancel is called', async function() {
        this.timeout(5000);
        const topic = `tøpic${Math.random()}`;
        const sensor = postgresSensor(conn, topic, `name${Math.random()}`, 'V');
        const since = new Date();
        let count = 0;
        const subscription = sensor.stream(since, 50, () => {
            count += 1;
        });
        subscription.cancel();
        const before = count;
        await new Promise((resolve) => { setTimeout(resolve, 200); });
        assert(count === before, 'callback was called after cancel');
    });

    it('does not crash when connection fails during stream', async function() {
        this.timeout(5000);
        const topic = `tøpic${Math.random()}`;
        const failingConn = {
            query() {
                return Promise.reject(new Error('ECONNRESET'));
            }
        };
        const sensor = postgresSensor(failingConn, topic, `name${Math.random()}`, 'V');
        const subscription = sensor.stream(new Date(), 100, () => {});
        await new Promise((resolve) => { setTimeout(resolve, 300); });
        subscription.cancel();
        assert(true, 'process should not crash on connection error');
    });

    it('returns found false when no data exists for current', async function() {
        const topic = `tøpic${Math.random()}`;
        const sensor = postgresSensor(conn, topic, `name${Math.random()}`, 'V');
        const result = await sensor.current();
        assert(result.found === false, 'expected found false for missing data');
    });

    it('returns found true when data exists for current', async function() {
        const topic = `tøpic${Math.random()}`;
        const now = new Date();
        await pool.query('INSERT INTO metrics (topic, ts, value) VALUES ($1, $2, $3)', [topic, now, Math.random()]);
        const sensor = postgresSensor(conn, topic, `name${Math.random()}`, 'V');
        const result = await sensor.current();
        assert(result.found === true, 'expected found true when data exists');
    });

    it('returns most recent value when multiple data points exist', async function() {
        const topic = `tøpic${Math.random()}`;
        const now = new Date();
        const older = Math.random() * 50;
        const newer = Math.random() * 50 + 50;
        await pool.query('INSERT INTO metrics (topic, ts, value) VALUES ($1, $2, $3)', [topic, new Date(now.getTime() - 5000), older]);
        await pool.query('INSERT INTO metrics (topic, ts, value) VALUES ($1, $2, $3)', [topic, now, newer]);
        const sensor = postgresSensor(conn, topic, `name${Math.random()}`, 'V');
        const result = await sensor.current();
        assert(Math.abs(result.value - newer) < 0.001, 'should return most recent value');
    });

    it('streams measurements bounded by clock', async function() {
        this.timeout(5000);
        const topic = `tøpic${Math.random()}`;
        const now = new Date();
        const past = new Date(now.getTime() - 2000);
        const future = new Date(now.getTime() + 5000);
        await pool.query('INSERT INTO metrics (topic, ts, value) VALUES ($1, $2, $3)', [topic, past, Math.random()]);
        await pool.query('INSERT INTO metrics (topic, ts, value) VALUES ($1, $2, $3)', [topic, future, Math.random()]);
        const sensor = postgresSensor(conn, topic, `name${Math.random()}`, 'V');
        const since = new Date(now.getTime() - 5000);
        const received = [];
        const subscription = sensor.stream(since, 100, (measurement) => {
            received.push(measurement);
        }, () => { return now; });
        await new Promise((resolve) => { setTimeout(resolve, 500); });
        subscription.cancel();
        assert(received.every((item) => { return item.timestamp <= now; }), 'stream emitted measurement beyond clock boundary');
    });
});
