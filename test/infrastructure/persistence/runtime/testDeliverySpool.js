import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import deliverySpool from '../../../../src/infrastructure/persistence/runtime/deliverySpool.js';

describe('Persistent delivery spool', () => {
    let directory;
    beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'spool-')); });
    afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
    it('recovers original event and per-recipient receipts after restart', async () => {
        const first = deliverySpool(directory, { maxBytes: 10000 });
        await first.open();
        await first.append({ eventId: 'a', value: 4 }, ['one', 'two']);
        await first.ack('a', 'one');
        await first.close();
        const recovered = deliverySpool(directory, { maxBytes: 10000 });
        await recovered.open();
        assert.deepEqual(await recovered.pending(), [{ event: { eventId: 'a', value: 4 }, remaining: ['two'] }]);
        await recovered.ack('a', 'two');
        assert.deepEqual(await recovered.pending(), []);
    });
    it('keeps the old data at capacity and refuses conflicting event identity', async () => {
        const spool = deliverySpool(directory, { maxBytes: 200 });
        await spool.open();
        await spool.append({ eventId: 'a', value: 'old' }, ['one']);
        await assert.rejects(spool.append({ eventId: 'b', value: 'x'.repeat(200) }, ['one']), /capacity/u);
        await assert.rejects(spool.append({ eventId: 'a', value: 'changed' }, ['one']), /identity/u);
        assert.equal((await spool.pending())[0].event.value, 'old');
    });
    it('does not resurrect an already confirmed recipient on duplicate append', async () => {
        const spool = deliverySpool(directory, { maxBytes: 10000 });
        await spool.open();
        await spool.append({ eventId: 'a' }, ['one', 'two']);
        await spool.ack('a', 'one');
        await spool.append({ eventId: 'a' }, ['one', 'two']);
        assert.deepEqual((await spool.pending())[0].remaining, ['two']);
    });
    it('rejects unknown acknowledgements and returns isolated copies', async () => {
        const spool = deliverySpool(directory, { maxBytes: 10000 });
        await spool.open();
        await spool.append({ eventId: '../a', value: 1 }, ['one']);
        await assert.rejects(spool.ack('../a', 'other'), /recipient/u);
        const rows = await spool.pending(); rows[0].event.value = 5;
        assert.equal((await spool.pending())[0].event.value, 1);
    });
});


describe('delivery spool record admission', () => {
    let directory;
    beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'spool-cap-')); });
    afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
    it('bounds tiny record count, preserves old records, and frees capacity only after confirmation', async () => {
        const spool = deliverySpool(directory, { maxBytes: 10000, maxRecords: 2 });
        await spool.open();
        await spool.append({ eventId: 'a' }, ['one', 'two']);
        await spool.append({ eventId: 'b' }, ['one']);
        await assert.rejects(spool.append({ eventId: 'c' }, ['one']), /record capacity/u);
        await spool.append({ eventId: 'a' }, ['one', 'two']);
        assert.equal(spool.status().recordLimit, 2);
        await spool.ack('a', 'one');
        await assert.rejects(spool.append({ eventId: 'c' }, ['one']), /record capacity/u);
        await spool.ack('a', 'two');
        await spool.append({ eventId: 'c' }, ['one']);
        assert.deepEqual((await spool.pending()).map((row) => { return row.event.eventId; }).sort(), ['b', 'c']);
    });
    it('recovers a full bounded spool and rejects a lowered limit without deleting data', async () => {
        const first = deliverySpool(directory, { maxBytes: 10000, maxRecords: 2 });
        await first.open();
        await first.append({ eventId: 'a' }, ['one']);
        await first.append({ eventId: 'b' }, ['one']);
        await first.close();
        const recovered = deliverySpool(directory, { maxBytes: 10000, maxRecords: 2 });
        await recovered.open();
        assert.equal(recovered.status().pending, 2);
        await assert.rejects(recovered.append({ eventId: 'c' }, ['one']), /record capacity/u);
        await recovered.close();
        const tooSmall = deliverySpool(directory, { maxBytes: 10000, maxRecords: 1 });
        await assert.rejects(tooSmall.open(), /record capacity/u);
        assert.equal(tooSmall.status().ready, false);
        const again = deliverySpool(directory, {maxBytes:10000,maxRecords:2});
        await again.open(); assert.equal(again.status().pending,2); await again.close();
    });
    it('validates a positive safe record limit and defaults to 100000', () => {
        [0, -1, 1.5, Infinity].forEach((maxRecords) => {
            assert.throws(() => { deliverySpool(directory, { maxBytes: 10000, maxRecords }); }, /maxRecords/u);
        });
        assert.equal(deliverySpool(directory, { maxBytes: 10000 }).status().recordLimit, 100000);
    });
});
