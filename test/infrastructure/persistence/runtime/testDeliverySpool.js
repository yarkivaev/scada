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
