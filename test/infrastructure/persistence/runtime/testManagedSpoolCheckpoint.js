import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import Database from 'better-sqlite3';
import deliverySpool from '../../../../src/infrastructure/persistence/runtime/deliverySpool.js';

describe('managed delivery spool checkpoint', () => {
    const walCheckpoint = { targetBytes: 64 * 1024, maxBytes: 128 * 1024 };
    let directory;
    let file;
    let spool;

    beforeEach(async () => {
        directory = await mkdtemp(path.join(os.tmpdir(), 'managed-spool-checkpoint-'));
        file = path.join(directory, 'delivery.sqlite');
        spool = deliverySpool(directory, { maxBytes: 10 * 1024 * 1024, walCheckpoint });
        await spool.open();
    });
    afterEach(async () => { await spool.close(); await rm(directory, { recursive: true, force: true }); });

    it('checkpoints an idle spool below the growth limit', async () => {
        const original = (await stat(file)).size;
        await spool.append({ eventId: 'idle', body: randomBytes(76 * 1024) }, ['target']);
        assert.equal((await stat(file)).size, original);
        const deadline = performance.now() + 1250;
        // Observe the backing file without issuing a checkpoint from the test.
        /* eslint-disable no-await-in-loop */
        while ((await stat(file)).size === original && performance.now() < deadline) {
            await pause(25);
        }
        /* eslint-enable no-await-in-loop */
        assert.ok((await stat(file)).size > original, 'The idle owner should checkpoint the committed WAL');
        assert.ok((await stat(`${file}-wal`)).size < walCheckpoint.maxBytes);
    });

    it('stops WAL growth when a reader pins it, then resumes without losing partial ACKs', async () => {
        await spool.append({ eventId: 'original' }, ['a', 'b']);
        const reader = new Database(file, { readonly: true });
        const observation = { eventId: 'large', body: randomBytes(200 * 1024) };
        try {
            reader.exec('BEGIN');
            reader.prepare('SELECT id FROM events').all();
            const results = await spool.mutateMany([
                { kind: 'append', event: observation, recipients: ['a', 'b'] },
                { kind: 'ack', eventId: 'large', recipient: 'a' }
            ]);
            assert.deepEqual(results, [{ ok: true }, { ok: true }]);
            const high = (await stat(`${file}-wal`)).size;
            assert.ok(high >= walCheckpoint.maxBytes);
            await assert.rejects(spool.append({ eventId: 'later' }, ['a']), /WAL growth limit/u);
            assert.equal((await stat(`${file}-wal`)).size, high);
            assert.equal(spool.status().ready, true);
        } finally { reader.close(); }
        await spool.append({ eventId: 'later' }, ['a']);
        assert.ok((await stat(`${file}-wal`)).size < walCheckpoint.maxBytes);
        await spool.close();
        await spool.open();
        const recovered = (await spool.peek()).find(row => { return row.event.eventId === 'large'; });
        assert.deepEqual(recovered, { event: observation, remaining: ['b'] });
    });

    it('recovers a durable observation and its ACK after SIGKILL before checkpoint', async () => {
        await spool.close();
        const worker = fork(new URL('../../../helpers/runtime/spoolChild.js', import.meta.url), [directory, 'write', 'managed']);
        const stopped = once(worker, 'exit');
        try {
            const [message] = await once(worker, 'message');
            assert.equal(message, 'committed');
            assert.ok((await stat(`${file}-wal`)).size > 0);
        } finally { worker.kill('SIGKILL'); await stopped; }
        await spool.open();
        assert.deepEqual(await spool.peek(), [{ event: { eventId: 'durable', body: Buffer.from('observation') }, remaining: ['two'] }]);
    });

    it('recovers from a transient maintenance stat failure after commit', async () => {
        const { statSync } = fs;
        let observations = 0;
        const probe = mock.method(fs, 'statSync', (name, ...args) => {
            if (name === `${file}-wal`) {
                observations += 1;
                if (observations === 2) { throw Object.assign(new Error('Injected WAL stat failure'), { code: 'EIO' }); }
            }
            return statSync(name, ...args);
        });
        syncBuiltinESMExports();
        try { await spool.append({ eventId: 'committed' }, ['target']); }
        finally { probe.mock.restore(); syncBuiltinESMExports(); }

        assert.equal(spool.status().ready, true);
        await assert.rejects(spool.append({ eventId: 'retry' }, ['target']), /Injected WAL stat failure/u);
        await spool.append({ eventId: 'retry' }, ['target']);
        assert.deepEqual((await spool.peek()).map(({ event }) => { return event.eventId; }), ['committed', 'retry']);
    });
});
