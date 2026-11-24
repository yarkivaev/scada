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

    it('does not write a second start when the next same-name island overlaps a pending heartbeat', async function() {
        const origin = 1_701_400_000_000 + Math.floor(Math.random() * 1e8);
        const priorStart = new Date(origin).toISOString();
        const heartbeat = new Date(origin + 20_000).toISOString();
        const store = sink();
        const wrapped = continuedSegments(store, priorPool({
            name: 'on',
            start_time: priorStart,
            end_time: heartbeat
        }), 30);
        await wrapped.write([{
            machine: `ičt-${Math.random()}`,
            kind: 'phase',
            name: 'on',
            start_time: new Date(origin + 549).toISOString(),
            end_time: heartbeat,
            duration: 0
        }]);
        assert.strictEqual(store.written[0].start_time, priorStart, 'overlapping heating was stored as its own start');
    });

    it('loads the previous row once for a same-machine batch', async function() {
        let selects = 0;
        const origin = 1_701_500_000_000 + Math.floor(Math.random() * 1e8);
        const machine = `ičt-${Math.random()}`;
        const pool = {
            query() {
                selects += 1;
                return Promise.resolve({ rows: [] });
            }
        };
        const store = sink();
        await continuedSegments(store, pool, 30).write([
            {
                machine, kind: 'phase', name: 'on',
                start_time: new Date(origin).toISOString(),
                end_time: new Date(origin + 5_000).toISOString(), duration: 0
            },
            {
                machine, kind: 'phase', name: 'on',
                start_time: new Date(origin + 8_000).toISOString(),
                end_time: new Date(origin + 12_000).toISOString(), duration: 0
            }
        ]);
        assert.equal(selects, 1, 'a same-machine batch still queried latest for every record');
    });
});
