import assert from 'assert';
import continuedSegments from '../../../../src/infrastructure/ingest/sinks/continuedSegments.js';

function priorPool(prior) {
    return {
        query() {
            return Promise.resolve({ rows: prior ? [prior] : [] });
        }
    };
}

function sink() {
    const written = [];
    return {
        written,
        write(records) {
            written.push(...records);
            return Promise.resolve();
        }
    };
}

describe('continuedSegments', function() {
    it('writes a restart fragment onto the previous continuous segment', async function() {
        const origin = 1_701_000_000_000 + Math.floor(Math.random() * 1e8);
        const priorStart = new Date(origin).toISOString();
        const store = sink();
        const wrapped = continuedSegments(store, priorPool({
            name: 'on',
            start_time: priorStart,
            end_time: new Date(origin + 10_000).toISOString()
        }), 30);
        await wrapped.write([{
            machine: `ičt-${Math.random()}`,
            kind: 'phase',
            name: 'on',
            start_time: new Date(origin + 15_000).toISOString(),
            end_time: new Date(origin + 20_000).toISOString(),
            duration: 0
        }]);
        assert.strictEqual(store.written[0].start_time, priorStart, 'restart fragment was stored as its own segment');
    });

    it('leaves the incoming start when metrics were not continuous', async function() {
        const origin = 1_701_100_000_000 + Math.floor(Math.random() * 1e8);
        const incoming = new Date(origin + 120_000).toISOString();
        const store = sink();
        const wrapped = continuedSegments(store, priorPool({
            name: 'on',
            start_time: new Date(origin).toISOString(),
            end_time: new Date(origin + 10_000).toISOString()
        }), 30);
        await wrapped.write([{
            machine: `ičt-${Math.random()}`,
            kind: 'phase',
            name: 'on',
            start_time: incoming,
            end_time: incoming,
            duration: 0
        }]);
        assert.strictEqual(store.written[0].start_time, incoming, 'a discontinuous fragment reused the previous start');
    });
});
