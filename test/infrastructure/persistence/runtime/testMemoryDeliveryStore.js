import assert from 'node:assert/strict';
import memoryDeliveryStore from '../../../../src/infrastructure/persistence/runtime/memoryDeliveryStore.js';
import { digest } from '../../../../src/infrastructure/persistence/runtime/spoolCodec.js';

const primary = { id: 'primary', type: 'amqp', url: 'amqp://receiver-one' };
const secondary = { id: 'secondary', type: 'amqp', url: 'amqp://receiver-two' };

function append(eventId, destinations = [primary], body = Buffer.from(eventId)) {
    return {
        kind: 'append', event: { eventId, observation: { eventId, body }, destinations },
        recipients: destinations.map(({ id }) => { return id; })
    };
}
function ack(eventId, recipient, admission) {
    return { kind: 'ack', eventId, recipient, admission };
}
function storedBytes({ event, recipients }, remaining = recipients) {
    return Buffer.byteLength(JSON.stringify({ event, recipients, remaining }));
}
async function opened(options = {}) {
    const store = memoryDeliveryStore({ maxBytes: 16384, maxRecords: 50, ...options });
    await store.open();
    return store;
}

describe('in-memory delivery store', () => {
    it('evicts the oldest insertion by count regardless of replay order', async () => {
        const store = await opened({ maxRecords: 2 });
        const first = append('oldest');
        await store.mutateMany([first, append('second')]);
        assert.equal((await store.pendingFair(1))[0].event.eventId, 'oldest');
        await store.mutateMany([append('third')]);
        assert.deepEqual((await store.peek()).map(row => { return row.event.eventId; }), ['second', 'third']);
        assert.equal(store.status().droppedRecords, 1);
        assert.equal(store.status().droppedBytes, storedBytes(first));
    });

    it('drops only as many old records as needed to fit a new event by bytes', async () => {
        const first = append('a');
        const second = append('b');
        const large = append('c', [primary], Buffer.alloc(40, 1));
        const maxBytes = storedBytes(large) + storedBytes(second);
        const store = await opened({ maxBytes });
        await store.mutateMany([first, second, large]);
        assert.deepEqual((await store.peek()).map(row => { return row.event.eventId; }), ['b', 'c']);
        assert.equal(store.status().bytes, maxBytes);
        assert.equal(store.status().droppedBytes, storedBytes(first));
    });

    it('rejects an oversized or conflicting append without evicting valid queued work', async () => {
        const kept = append('kept');
        const store = await opened({ maxBytes: storedBytes(kept) * 2 });
        await store.mutateMany([kept]);
        const outcomes = await store.mutateMany([
            append('oversized', [primary], Buffer.alloc(2000)), append('kept', [secondary]), kept
        ]);
        assert.match(outcomes[0].error.message, /capacity/u);
        assert.match(outcomes[1].error.message, /conflicting event identity/iu);
        assert.deepEqual(outcomes[2], { ok: true });
        assert.deepEqual(await store.peek(), [{ event: kept.event, remaining: ['primary'] }]);
        assert.equal(store.status().droppedRecords, 0);
    });

    it('keeps immutable events and accounts for partial acknowledgements exactly', async () => {
        const store = await opened();
        const item = append('event', [primary, secondary], Buffer.from('initial'));
        const expected = { ...item.event, observation: { eventId: 'event', body: Buffer.from('initial') } };
        await store.mutateMany([item]);
        item.event.observation.body.fill(0);
        const [row] = await store.pendingFair(1);
        assert.deepEqual(row.event, expected);
        row.event.observation.body.fill(0);
        assert.deepEqual(await store.mutateMany([ack('event', 'primary', row.admission)]), [{ ok: true }]);
        assert.deepEqual(await store.peek(), [{ event: expected, remaining: ['secondary'] }]);
        assert.equal(store.status().bytes, storedBytes({ ...item, event: expected }, ['secondary']));
        assert.equal(store.status().droppedRecords, 0);
    });

    it('uses destination digests for blocking and rotates a failed recipient independently', async () => {
        const store = await opened();
        const moved = { ...primary, url: 'amqp://receiver-new' };
        await store.mutateMany([append('a'), append('b'), append('c', [moved, secondary])]);
        const oldTarget = digest(JSON.stringify(primary));
        const [healthy] = await store.pendingFair(1, [oldTarget]);
        assert.equal(healthy.event.eventId, 'c');
        assert.equal(healthy.targets.primary, digest(JSON.stringify(moved)));
        const [next] = await store.pendingFair(1, [oldTarget, healthy.targets.primary]);
        assert.deepEqual(next.remaining, ['secondary']);
        await store.mutateMany([ack('c', 'secondary', next.admission)]);
        const blocked = [digest(JSON.stringify(moved))];
        const [first] = await store.pendingFair(1, blocked);
        const [retry] = await store.pendingFair(1, blocked);
        assert.deepEqual([first.event.eventId, retry.event.eventId], ['a', 'b']);
    });

    it('bounds decoded replay pages by bytes and still advances to the next record', async () => {
        const store = await opened({ maxBytes: 6 * 1024 * 1024 });
        const body = 'x'.repeat(1600000);
        await store.mutateMany(['a', 'b', 'c'].map(id => { return append(id, [primary], body); }));
        const first = await store.pendingFair(10);
        const next = await store.pendingFair(10);
        assert.deepEqual(first.map(row => { return row.event.eventId; }), ['a', 'b']);
        assert.deepEqual(next.map(row => { return row.event.eventId; }), ['c', 'a']);
    });

    it('ignores confirmations for an evicted admission when its event ID is reused', async () => {
        const store = await opened({ maxRecords: 1 });
        await store.mutateMany([append('same')]);
        const [original] = await store.pendingFair(1);
        await store.mutateMany([append('other'), append('same', [primary], Buffer.from('new'))]);
        const [replacement] = await store.pendingFair(1);
        assert.notEqual(original.admission, replacement.admission);
        assert.deepEqual(await store.mutateMany([ack('same', 'primary', original.admission)]), [{ ok: true }]);
        assert.equal(store.status().pending, 1);
        assert.deepEqual(await store.mutateMany([ack('same', 'primary', replacement.admission)]), [{ ok: true }]);
        assert.equal(store.status().pending, 0);
        assert.equal(store.status().droppedRecords, 2);
    });

    it('releases volatile events on close without reusing admission identities', async () => {
        const store = await opened();
        await store.mutateMany([append('same')]);
        const [original] = await store.pendingFair(1);
        await store.close();
        await assert.rejects(store.peek(), /not opened/u);
        assert.equal(store.status().pending, 0);
        await store.open();
        await store.mutateMany([append('same')]);
        const [replacement] = await store.pendingFair(1);
        assert.notEqual(original.admission, replacement.admission);
    });
});
