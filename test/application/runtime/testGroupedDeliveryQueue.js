import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import createQueue from '../../../src/application/runtime/deliveryQueue.js';
import memoryDeliveryStore from '../../../src/infrastructure/persistence/runtime/memoryDeliveryStore.js';

const destinations = [{ id: 'one', type: 'amqp' }];
function gate() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
const owned = [];
function queue({ onGroup, ...options } = {}) {
    const config = { maxBytes: 100000, factory() { return { async write() {} }; }, ...options };
    const store = memoryDeliveryStore(config);
    const value = createQueue(config, onGroup ? { ...store, mutateMany(operations) {
        onGroup(operations);
        return store.mutateMany(operations);
    } } : store);
    owned.push(value);
    return value;
}

describe('grouped node delivery queue', () => {
    afterEach(async () => { await Promise.all(owned.splice(0).map(item => { return item.close(); })); });

    it('applies concurrent accepts in groups bounded by the configured record count', async () => {
        const groups = [];
        const item = queue({ groupCommit: { maxRecords: 2 }, onGroup(operations) {
            groups.push(operations.map(operation => { return operation.event.eventId; }));
        } });
        await item.open();
        await Promise.all(['a', 'b', 'c'].map(eventId => { return item.accept({ eventId }, destinations); }));
        assert.deepEqual(groups, [['a', 'b'], ['c']]);
        assert.equal(item.status().pending, 3);
    });

    it('groups confirmed receipts from a drained page', async () => {
        const groups = [];
        const item = queue({ onGroup(operations) {
            groups.push(operations.map(operation => { return [operation.kind, operation.eventId ?? operation.event.eventId]; }));
        } });
        await item.open();
        await Promise.all(['a', 'b', 'c'].map(eventId => { return item.accept({ eventId }, destinations); }));
        assert.deepEqual(await item.drain(), { delivered: 3, failed: 0 });
        assert.deepEqual(groups, [
            [['append', 'a'], ['append', 'b'], ['append', 'c']],
            [['ack', 'a'], ['ack', 'b'], ['ack', 'c']]
        ]);
        assert.equal(item.status().pending, 0);
    });

    it('flushes sparse accepts on close and captures their original bodies and recipients', async () => {
        const snapshots = [];
        const item = queue({ groupCommit: { maxDelayMs: 1000 }, onGroup(operations) { snapshots.push(...operations); } });
        await item.open();
        const body = Buffer.from('frozen');
        const target = [{ id: 'one', type: 'amqp' }];
        const accepted = item.accept({ eventId: 'a', body }, target);
        body.fill(0);
        target[0].id = 'changed';
        const timeout = new AbortController();
        try {
            await Promise.race([item.close(), pause(500, null, { signal: timeout.signal }).then(() => {
                throw new Error('Close did not force sparse flush');
            })]);
        } finally { timeout.abort(); }
        await accepted;
        assert.deepEqual(snapshots.map(({ event, recipients }) => {
            return [Buffer.from(event.observation.body.data).toString(), recipients, event.destinations];
        }), [['frozen', ['one'], destinations]]);
        assert.equal(item.status().pending, 0);
    });

    it('holds receipt capacity until confirmation and accepts the receipt during graceful close', async () => {
        const entered = gate();
        const confirmed = gate();
        const item = queue({ maxOperations: 1, factory() {
            return { async write() { entered.resolve(); await confirmed.promise; } };
        } });
        await item.open();
        await item.accept({ eventId: 'a' }, destinations);
        const draining = item.drain();
        await entered.promise;
        const excess = assert.rejects(item.accept({ eventId: 'b' }, destinations), /operation.*capacity/iu);
        void excess.catch(() => {
            // The assertion is observed after releasing the blocked broker.
        });
        try {
            let closed = false;
            const closing = item.close().then(() => { closed = true; });
            await pause(5);
            assert.equal(closed, false);
            assert.equal(item.status().queuedOperations, 1);
            confirmed.resolve();
            assert.deepEqual(await draining, { delivered: 1, failed: 0 });
            await excess;
            await closing;
            assert.equal(item.status().queuedOperations, 0);
        } finally { confirmed.resolve(); }
    });

    it('rejects excess operations before snapshotting and rejects input over the pending byte capacity', async () => {
        const item = queue({ maxOperations: 1 });
        await item.open();
        const first = item.accept({ eventId: 'a' }, destinations);
        let snapshots = 0;
        await assert.rejects(item.accept({ eventId: 'b', toJSON() {
            snapshots += 1;
            return { eventId: 'b' };
        } }, destinations), /operation.*capacity/iu);
        assert.equal(snapshots, 0);
        await first;
        await item.accept({ eventId: 'b' }, destinations);
        assert.equal(item.status().pending, 2);

        const bytes = queue({ maxPendingBytes: 512 });
        await bytes.open();
        const kept = bytes.accept({ eventId: 'small' }, destinations);
        await assert.rejects(bytes.accept({ eventId: 'large', value: 'x'.repeat(1000) }, destinations), /byte capacity/u);
        await kept;
        assert.equal(bytes.status().pending, 1);
    });

    it('rejects a failed mutation group without retaining its admissions', async () => {
        let fail = true;
        const item = queue({ onGroup() { if (fail) { throw new Error('append fault'); } } });
        await item.open();
        const outcomes = await Promise.allSettled(['a', 'b', 'c'].map(eventId => { return item.accept({ eventId }, destinations); }));
        assert(outcomes.every(result => { return result.status === 'rejected' && result.reason.message === 'append fault'; }));
        assert.equal(item.status().queuedOperations, 0);
        assert.deepEqual(await item.peek(), []);
        fail = false;
        await item.accept({ eventId: 'd' }, destinations);
        assert.equal(item.status().pending, 1);
    });

    it('rejects oversized input before constructing a decoded queued snapshot', async () => {
        const item = queue({ maxPendingBytes: 256 });
        await item.open();
        const original = JSON.parse;
        JSON.parse = function parse(text, ...args) {
            if (text.includes('oversized-marker')) { throw new Error('oversized snapshot parsed'); }
            return original(text, ...args);
        };
        try {
            await assert.rejects(item.accept({ eventId: 'large', value: 'oversized-marker'.repeat(100) }, destinations), /byte capacity/u);
        } finally { Object.assign(JSON, { parse: original }); }
        assert.equal(item.status().queuedOperations, 0);
        assert.equal(item.status().pending, 0);
    });

    it('keeps records available for retry when a receipt group fails', async () => {
        let fail = true;
        const item = queue({ failureCooldownMs: 0, onGroup(operations) {
            if (fail && operations[0].kind === 'ack') { throw new Error('receipt fault'); }
        } });
        await item.open();
        await Promise.all(['a', 'b'].map(eventId => { return item.accept({ eventId }, destinations); }));
        assert.deepEqual(await item.drain(), { delivered: 0, failed: 2 });
        assert.equal(item.status().queuedOperations, 0);
        assert.equal(item.status().pending, 2);
        fail = false;
        assert.deepEqual(await item.drain(), { delivered: 2, failed: 0 });
        assert.equal(item.status().pending, 0);
    });

    it('closes with both an accepted sparse append and an in-flight confirmed receipt', async () => {
        const entered = gate();
        const confirmed = gate();
        const item = queue({ groupCommit: { maxDelayMs: 1000 }, factory() {
            return { async write() { entered.resolve(); await confirmed.promise; } };
        } });
        await item.open();
        const first = item.accept({ eventId: 'a' }, destinations);
        const flushing = item.drain();
        await first;
        await entered.promise;
        try {
            const second = item.accept({ eventId: 'b' }, destinations);
            const closing = item.close();
            confirmed.resolve();
            assert.deepEqual(await flushing, { delivered: 1, failed: 0 });
            await second;
            await closing;
            assert.equal(item.status().pending, 0);
        } finally { confirmed.resolve(); }
    });
});
