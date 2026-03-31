import assert from 'assert';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sqliteSensor from '../src/sqliteSensor.js';

function sqliteConnection(path) {
    const db = new Database(path);
    db.pragma('journal_mode = WAL');
    db.exec(`CREATE TABLE IF NOT EXISTS metrics (
        topic TEXT NOT NULL,
        ts REAL NOT NULL,
        value REAL NOT NULL
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_metrics ON metrics (topic, ts)');
    return {
        query(sql, params = []) {
            return Promise.resolve(db.prepare(sql).all(...params));
        },
        insert(records) {
            const stmt = db.prepare('INSERT INTO metrics (topic, ts, value) VALUES (?, ?, ?)');
            for (const row of records) {
                stmt.run(row.topic, row.ts, row.value);
            }
        },
        close() {
            db.close();
        }
    };
}

describe('sqliteSensor', function() {
    it('returns display name when name is called', function() {
        const dir = mkdtempSync(join(tmpdir(), 'sensor-'));
        const conn = sqliteConnection(join(dir, 'db.sqlite'));
        try {
            const topic = `tøpic${Math.random()}`;
            const name = `Spännung${Math.random()}`;
            const sensor = sqliteSensor(conn, topic, name, 'V');
            assert(sensor.name() === name, 'name mismatch');
        } finally {
            conn.close();
            rmSync(dir, { recursive: true });
        }
    });

    it('returns empty array when no measurements exist', async function() {
        const dir = mkdtempSync(join(tmpdir(), 'sensor-'));
        const conn = sqliteConnection(join(dir, 'db.sqlite'));
        try {
            const topic = `tøpic${Math.random()}`;
            const sensor = sqliteSensor(conn, topic, `name${Math.random()}`, 'V');
            const now = new Date();
            const result = await sensor.measurements({
                start: new Date(now.getTime() - 1000),
                end: new Date(now.getTime() + 1000)
            }, 1000);
            assert(result.length === 0, 'expected empty array');
        } finally {
            conn.close();
            rmSync(dir, { recursive: true });
        }
    });

    it('returns measurements within time range', async function() {
        const dir = mkdtempSync(join(tmpdir(), 'sensor-'));
        const conn = sqliteConnection(join(dir, 'db.sqlite'));
        try {
            const topic = `tøpic${Math.random()}`;
            const now = new Date();
            const value = Math.random() * 100;
            conn.insert([{ topic, ts: now.getTime(), value }]);
            const sensor = sqliteSensor(conn, topic, `name${Math.random()}`, 'V');
            const result = await sensor.measurements({
                start: new Date(now.getTime() - 10000),
                end: new Date(now.getTime() + 10000)
            }, 1000);
            assert(result.length >= 1, 'expected at least one measurement');
        } finally {
            conn.close();
            rmSync(dir, { recursive: true });
        }
    });

    it('returns measurements with correct value', async function() {
        const dir = mkdtempSync(join(tmpdir(), 'sensor-'));
        const conn = sqliteConnection(join(dir, 'db.sqlite'));
        try {
            const topic = `tøpic${Math.random()}`;
            const now = new Date();
            const value = Math.random() * 100;
            conn.insert([{ topic, ts: now.getTime(), value }]);
            const sensor = sqliteSensor(conn, topic, `name${Math.random()}`, 'V');
            const result = await sensor.measurements({
                start: new Date(now.getTime() - 10000),
                end: new Date(now.getTime() + 10000)
            }, 1000);
            assert(Math.abs(result[0].value - value) < 0.001, 'value mismatch');
        } finally {
            conn.close();
            rmSync(dir, { recursive: true });
        }
    });

    it('returns measurements with correct unit', async function() {
        const dir = mkdtempSync(join(tmpdir(), 'sensor-'));
        const conn = sqliteConnection(join(dir, 'db.sqlite'));
        try {
            const topic = `tøpic${Math.random()}`;
            const unit = `cos(φ)${Math.random()}`;
            const now = new Date();
            conn.insert([{ topic, ts: now.getTime(), value: Math.random() }]);
            const sensor = sqliteSensor(conn, topic, `name${Math.random()}`, unit);
            const result = await sensor.measurements({
                start: new Date(now.getTime() - 10000),
                end: new Date(now.getTime() + 10000)
            }, 1000);
            assert(result[0].unit === unit, 'unit mismatch');
        } finally {
            conn.close();
            rmSync(dir, { recursive: true });
        }
    });

    it('streams new measurements to callback', async function() {
        this.timeout(5000);
        const dir = mkdtempSync(join(tmpdir(), 'sensor-'));
        const conn = sqliteConnection(join(dir, 'db.sqlite'));
        try {
            const topic = `tøpic${Math.random()}`;
            const now = new Date();
            const value = Math.random() * 100;
            conn.insert([{ topic, ts: now.getTime(), value }]);
            const sensor = sqliteSensor(conn, topic, `name${Math.random()}`, 'V');
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
        } finally {
            conn.close();
            rmSync(dir, { recursive: true });
        }
    });

    it('cancels streaming when cancel is called', async function() {
        this.timeout(5000);
        const dir = mkdtempSync(join(tmpdir(), 'sensor-'));
        const conn = sqliteConnection(join(dir, 'db.sqlite'));
        try {
            const topic = `tøpic${Math.random()}`;
            const sensor = sqliteSensor(conn, topic, `name${Math.random()}`, 'V');
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
        } finally {
            conn.close();
            rmSync(dir, { recursive: true });
        }
    });

    it('does not crash when connection fails during stream', async function() {
        this.timeout(5000);
        const topic = `tøpic${Math.random()}`;
        const failingConn = {
            query() {
                return Promise.reject(new Error('ECONNRESET'));
            }
        };
        const sensor = sqliteSensor(failingConn, topic, `name${Math.random()}`, 'V');
        const subscription = sensor.stream(new Date(), 100, () => {});
        await new Promise((resolve) => {
            setTimeout(resolve, 300);
        });
        subscription.cancel();
        assert(true, 'process should not crash on connection error');
    });

    it('returns found false when no data exists for current', async function() {
        const dir = mkdtempSync(join(tmpdir(), 'sensor-'));
        const conn = sqliteConnection(join(dir, 'db.sqlite'));
        try {
            const topic = `tøpic${Math.random()}`;
            const sensor = sqliteSensor(conn, topic, `name${Math.random()}`, 'V');
            const result = await sensor.current();
            assert(result.found === false, 'expected found false for missing data');
        } finally {
            conn.close();
            rmSync(dir, { recursive: true });
        }
    });

    it('returns found true when data exists for current', async function() {
        const dir = mkdtempSync(join(tmpdir(), 'sensor-'));
        const conn = sqliteConnection(join(dir, 'db.sqlite'));
        try {
            const topic = `tøpic${Math.random()}`;
            const now = new Date();
            conn.insert([{ topic, ts: now.getTime(), value: Math.random() }]);
            const sensor = sqliteSensor(conn, topic, `name${Math.random()}`, 'V');
            const result = await sensor.current();
            assert(result.found === true, 'expected found true when data exists');
        } finally {
            conn.close();
            rmSync(dir, { recursive: true });
        }
    });

    it('returns latest value when data exists for current', async function() {
        const dir = mkdtempSync(join(tmpdir(), 'sensor-'));
        const conn = sqliteConnection(join(dir, 'db.sqlite'));
        try {
            const topic = `tøpic${Math.random()}`;
            const now = new Date();
            const value = Math.random() * 100;
            conn.insert([{ topic, ts: now.getTime(), value }]);
            const sensor = sqliteSensor(conn, topic, `name${Math.random()}`, 'V');
            const result = await sensor.current();
            assert(Math.abs(result.value - value) < 0.001, 'current value mismatch');
        } finally {
            conn.close();
            rmSync(dir, { recursive: true });
        }
    });

    it('returns correct unit when data exists for current', async function() {
        const dir = mkdtempSync(join(tmpdir(), 'sensor-'));
        const conn = sqliteConnection(join(dir, 'db.sqlite'));
        try {
            const topic = `tøpic${Math.random()}`;
            const unit = `cosφ${Math.random()}`;
            const now = new Date();
            conn.insert([{ topic, ts: now.getTime(), value: Math.random() }]);
            const sensor = sqliteSensor(conn, topic, `name${Math.random()}`, unit);
            const result = await sensor.current();
            assert(result.unit === unit, 'current unit mismatch');
        } finally {
            conn.close();
            rmSync(dir, { recursive: true });
        }
    });

    it('streams measurements bounded by clock', async function() {
        this.timeout(5000);
        const dir = mkdtempSync(join(tmpdir(), 'sensor-'));
        const conn = sqliteConnection(join(dir, 'db.sqlite'));
        try {
            const topic = `tøpic${Math.random()}`;
            const now = new Date();
            const past = new Date(now.getTime() - 2000);
            const future = new Date(now.getTime() + 5000);
            conn.insert([
                { topic, ts: past.getTime(), value: Math.random() },
                { topic, ts: future.getTime(), value: Math.random() }
            ]);
            const sensor = sqliteSensor(conn, topic, `name${Math.random()}`, 'V');
            const since = new Date(now.getTime() - 5000);
            const received = [];
            const subscription = sensor.stream(since, 100, (measurement) => {
                received.push(measurement);
            }, () => { return now; });
            await new Promise((resolve) => {
                setTimeout(resolve, 500);
            });
            subscription.cancel();
            assert(received.every((item) => { return item.timestamp <= now; }), 'stream emitted measurement beyond clock boundary');
        } finally {
            conn.close();
            rmSync(dir, { recursive: true });
        }
    });

    it('returns most recent value when multiple data points exist', async function() {
        const dir = mkdtempSync(join(tmpdir(), 'sensor-'));
        const conn = sqliteConnection(join(dir, 'db.sqlite'));
        try {
            const topic = `tøpic${Math.random()}`;
            const now = new Date();
            const older = Math.random() * 50;
            const newer = Math.random() * 50 + 50;
            conn.insert([
                { topic, ts: now.getTime() - 5000, value: older },
                { topic, ts: now.getTime(), value: newer }
            ]);
            const sensor = sqliteSensor(conn, topic, `name${Math.random()}`, 'V');
            const result = await sensor.current();
            assert(Math.abs(result.value - newer) < 0.001, 'should return most recent value');
        } finally {
            conn.close();
            rmSync(dir, { recursive: true });
        }
    });
});
