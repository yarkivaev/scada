import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import spoolFactory from '../../../../src/infrastructure/persistence/runtime/deliverySpool.js';

describe('durable recipient replay index', () => {
    let directory;
    const owned = [];
    const destinations = [{ id: 'a', type: 'amqp', url: 'amqp://a' }, { id: 'b', type: 'amqp', url: 'amqp://b' }];

    function spool() {
        const value = spoolFactory(directory, { maxBytes: 1000000 });
        owned.push(value);
        return value;
    }

    function withDatabase(action) {
        const db = new Database(path.join(directory, 'delivery.sqlite'));
        try { return action(db); } finally { db.close(); }
    }

    function toVersionOne() {
        // Keep every canonical table and row as the 2.6.38 collector wrote it.
        withDatabase(db => {
            db.exec('DROP TABLE IF EXISTS replay_pending; DROP TABLE IF EXISTS replay_targets; PRAGMA user_version=1;');
        });
    }

    beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'replay-index-')); });
    afterEach(async () => {
        await Promise.all(owned.splice(0).map(item => { return item.close(); }));
        await rm(directory, { recursive: true, force: true });
    });

    it('migrates v1 records and partial confirmations using the canonical database', async () => {
        const first = spool();
        await first.open();
        await first.append({ eventId: 'point', destinations }, ['a', 'b']);
        await first.ack('point', 'a');
        await first.append({ eventId: 'legacy' }, ['a']);
        await first.close();
        toVersionOne();
        const oldIndex = path.join(directory, 'replay-index.sqlite');
        await writeFile(oldIndex, 'crash-corrupted-disposable-index');

        const next = spool();
        await next.open();
        assert.equal(withDatabase(db => { return db.pragma('user_version', { simple: true }); }), 2);
        assert.equal(await readFile(oldIndex, 'utf8'), 'crash-corrupted-disposable-index');
        const rows = await next.pendingFair(100);
        assert.deepEqual(rows.map(row => { return [row.event.eventId, row.remaining]; }), [['point', ['b']], ['legacy', ['a']]]);
        assert.deepEqual(rows[0].event.destinations, destinations);
        await next.ack('point', 'b');
        await next.ack('legacy', 'a');
        assert.deepEqual(await next.pendingFair(100), []);
        assert.equal(withDatabase(db => { return db.prepare('SELECT COUNT(*) AS count FROM replay_targets').get().count; }), 0);
    });

    it('resumes the committed replay order after reopening', async () => {
        const first = spool();
        await first.open();
        await first.append({ eventId: 'first' }, ['a']);
        await first.append({ eventId: 'second' }, ['a']);
        assert.equal((await first.pendingFair(1))[0].event.eventId, 'first');
        await first.close();

        const next = spool();
        await next.open();
        assert.equal((await next.pendingFair(1))[0].event.eventId, 'second');
    });

    it('rolls back a failed v1 migration and can retry without dropping canonical rows', async () => {
        const first = spool();
        await first.open();
        await first.append({ eventId: 'point' }, ['a']);
        await first.close();
        toVersionOne();
        withDatabase(db => {
            db.prepare('UPDATE events SET recipients=? WHERE id=?').run('["a","a"]', 'point');
        });

        await assert.rejects(spool().open(), { code: 'SQLITE_CONSTRAINT_PRIMARYKEY' });
        withDatabase(db => {
            assert.equal(db.pragma('user_version', { simple: true }), 1);
            assert.equal(db.prepare("SELECT COUNT(*) FROM sqlite_schema WHERE name GLOB 'replay_*'").pluck().get(), 0);
            assert.deepEqual(db.prepare('SELECT id,remaining FROM events').get(), { id: 'point', remaining: '["a"]' });
            db.prepare('UPDATE events SET recipients=? WHERE id=?').run('["a"]', 'point');
        });
        const next = spool();
        await next.open();
        assert.equal((await next.pendingFair(1))[0].event.eventId, 'point');
    });

    it('keeps destination and recipient selection indexed', async () => {
        await spool().open();
        withDatabase(db => {
            const explain = sql => { return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(row => { return row.detail; }).join(' '); };
            assert.match(explain('SELECT id FROM replay_targets ORDER BY sequence LIMIT 100'), /replay_target_sequence/u);
            assert.match(explain("SELECT event_id,recipient FROM replay_pending WHERE target='x' ORDER BY sequence LIMIT 100"), /SEARCH replay_pending USING PRIMARY KEY/u);
            assert.match(explain("SELECT target FROM replay_pending WHERE event_id='point' AND recipient='a'"), /replay_event_recipient/u);
        });
    });
});
