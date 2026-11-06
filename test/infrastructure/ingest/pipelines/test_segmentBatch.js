import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import segmentBatch from '../../../../src/infrastructure/ingest/pipelines/segmentBatch.js';

function record(index, changes = {}) {
    return { type: 'segment', machine: 'fixture', kind: 'phase', name: index % 2 ? 'off' : 'on',
        start_time: new Date(1700000000000 + index * 60000).toISOString(),
        end_time: new Date(1700000060000 + index * 60000).toISOString(), duration: 60,
        tags: '[]', properties: '{}', options: null, resolved: true, ...changes };
}
function fixture(settings = {}, writer = async () => {}) {
    const state = { writes: [], acked: [], nacked: [], failures: [], stats: [] };
    state.batch = segmentBatch(async rows => { state.writes.push(rows);return writer(rows); }, {
        maxMessages: 2, completedSegments: 0, maxWaitMs: 25, maxBytes: 1000, prefetch: 8,
        onFatal(error) { state.failures.push(error); }, onBatch(stats) { state.stats.push(stats); }, ...settings
    });
    state.send = (index, changes = {}, bytes = 10) => {
        const promise = state.batch.accept({ record: record(index, changes), bytes,
            settle: { ack() { state.acked.push(index); }, nack(requeue) { state.nacked.push({ index, requeue }); } } });
        void promise.catch(() => {});return promise;
    };
    return state;
}
describe('bounded segment batch scheduling', () => {
    it('flushes a partial batch on age when no segment end arrives', async () => {
        const test = fixture({ maxMessages: 8 });
        try { await test.send(0, { duration: 0 });assert.deepEqual(test.acked, [0]);assert.equal(test.stats[0].reason, 'age'); }
        finally { await test.batch.stop(); }
    });
    it('flushes when the requested number of distinct segment endings arrives', async () => {
        const test = fixture({ maxMessages: 8, completedSegments: 2, maxWaitMs: 1000 });
        try {
            const first = test.send(0);await delay(10);assert.deepEqual(test.acked, []);
            await Promise.all([first, test.send(1)]);
            assert.deepEqual(test.acked, [0, 1]);assert.equal(test.stats[0].reason, 'segments');
        } finally { await test.batch.stop(); }
    });
    it('releases broker credit even if configured message target exceeds prefetch', async () => {
        const test = fixture({ maxMessages: 1000, prefetch: 2, maxWaitMs: 1000 });
        try { await Promise.all([test.send(0), test.send(1)]);assert.equal(test.stats[0].reason, 'messages'); }
        finally { await test.batch.stop(); }
    });
    it('splits on byte limit and allows one transport-valid oversized envelope alone', async () => {
        const test = fixture({ maxMessages: 8, maxBytes: 15 });
        try {
            await Promise.all([test.send(0), test.send(1), test.send(2, {}, 20)]);
            assert.deepEqual(test.writes.map(rows => {return rows.length}), [1, 1, 1]);
            assert.deepEqual(test.acked, [0, 1, 2]);
        } finally { await test.batch.stop(); }
    });
    it('retains every pending command, terminal transition and receipt', async () => {
        const test = fixture({ maxMessages: 8, completedSegments: 1 });
        const base = record(0, { duration: 0 });
        try {
            const pending = test.send(0, base);
            const next = test.send(1, { ...base, end_time: '2023-11-14T22:15:20.000Z' });
            const terminal = test.send(2, { ...base, end_time: '2023-11-14T22:16:20.000Z', duration: 180 });
            await Promise.all([pending, next, terminal]);
            assert.deepEqual(test.writes[0].map(row => {return row.duration}), [0, 0, 180]);
            assert.deepEqual(test.acked, [0, 1, 2]);
        } finally { await test.batch.stop(); }
    });
    it('keeps split/segment last-occurrence order and does not drop a retag', async () => {
        const test = fixture({ maxMessages: 6 });
        const base = record(0, { duration: 0 });
        try {
            await Promise.all([
                test.send(0, { ...base, type: 'split' }), test.send(1, base),
                test.send(2, { ...base, type: 'split' }), test.send(3, base),
                test.send(4, { ...base, type: 'retag', tags: '["operator"]' }), test.send(5, base)
            ]);
            assert.deepEqual(test.writes[0].map(row => {return row.type}), ['split', 'segment', 'split', 'segment', 'retag', 'segment']);
            assert.deepEqual(test.acked.slice().sort(), [0, 1, 2, 3, 4, 5]);
        } finally { await test.batch.stop(); }
    });
    it('preserves machine FIFO while allowing another machine to progress', async () => {
        let release;
        const test = fixture({ maxMessages: 1, concurrency: 2 }, async rows => {
            if (rows[0].name === 'slow') { await new Promise(resolve => { release = resolve; }); }
        });
        try {
            const slow = test.send(0, { name: 'slow' });const later = test.send(1);
            const fast = test.send(2, { machine: 'other' });await fast;
            assert.deepEqual(test.acked, [2]);release();await Promise.all([slow, later]);
            assert.deepEqual(test.acked, [2, 0, 1]);
        } finally { release?.();await test.batch.stop(); }
    });
    it('rolls back a permanent batch failure and commits valid commands individually', async () => {
        const test = fixture({ maxMessages: 3, deadLetter: true }, async rows => {
            if (rows.some(row => {return row.name === 'bad'})) { throw Object.assign(new Error('invalid row'), { permanent: true }); }
        });
        try {
            const results = await Promise.allSettled([test.send(0), test.send(1, { name: 'bad' }), test.send(2)]);
            assert.deepEqual(results.map(result => {return result.status}), ['fulfilled', 'rejected', 'fulfilled']);
            assert.deepEqual(test.acked, [0, 2]);assert.deepEqual(test.nacked, [{ index: 1, requeue: false }]);
            assert.deepEqual(test.failures, []);
        } finally { await test.batch.stop(); }
    });
    it('fences a failed transaction once and never acknowledges pending work', async () => {
        const failure = new Error('uncertain COMMIT');
        const test = fixture({ maxMessages: 1 }, async () => { throw failure; });
        try {
            const result = await Promise.allSettled([test.send(0), test.send(1)]);
            assert.deepEqual(result.map(value => {return value.status}), ['rejected', 'rejected']);
            assert.deepEqual(test.failures, [failure]);assert.deepEqual(test.acked, []);
        } finally { await test.batch.stop(); }
    });
    it('bounds shutdown and prevents late acknowledgements after abort', async () => {
        let release;
        const test = fixture({ maxMessages: 1, stopTimeoutMs: 15 }, async () => {
            await new Promise(resolve => { release = resolve; });
        });
        const pending = test.send(0);await delay(5);
        await assert.rejects(test.batch.stop(), /Segment batch stop/u);
        await assert.rejects(pending, /stopped/u);release();await delay(5);
        assert.deepEqual(test.acked, []);assert.deepEqual(test.failures, []);
    });
    it('limits concurrent transactions even when more independent machines are ready', async () => {
        let active = 0;let peak = 0;const gates = [];
        const test = fixture({ maxMessages: 1, concurrency: 2 }, async () => {
            active += 1;peak = Math.max(peak, active);
            await new Promise(resolve => { gates.push(resolve); });active -= 1;
        });
        try {
            const pending = [test.send(0), test.send(1, { machine: 'second' }), test.send(2, { machine: 'third' })];
            await delay(5);assert.equal(active, 2);assert.equal(gates.length, 2);
            gates.shift()();await delay(5);assert.equal(gates.length, 2);
            gates.forEach(resolve => { resolve(); });await Promise.all(pending);
            assert.equal(peak, 2);assert.equal(test.acked.length, 3);
        } finally { gates.forEach(resolve => { resolve(); });await test.batch.stop(); }
    });

});
