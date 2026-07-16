import assert from 'assert';
import segmentDispatch from '../../../src/domain/segment/dispatch.js';

/**
 * Fake UPSERT sink keyed by (machine, start_time), mirroring postgresSink conflict behavior.
 */
function upsertSink() {
    const rows = new Map();
    return {
        rows,
        write(records) {
            for (const record of records) {
                const key = `${record.machine}|${record.start_time}`;
                const prior = rows.get(key) || {};
                rows.set(key, { ...prior, ...record });
            }
            return Promise.resolve();
        }
    };
}

describe('segmentDispatch pending restore', function() {
    it('restores a silence-closed row when a pending heartbeat arrives for the same start', async function() {
        const sink = upsertSink();
        const closer = { close() { return Promise.resolve(); } };
        const route = segmentDispatch(sink, { accept() { return Promise.resolve(); } }, upsertSink(), closer);
        const machine = `ičt-${Math.random().toString(36).slice(2)}`;
        const start = new Date(1_700_000_000_000 + Math.floor(Math.random() * 1e8)).toISOString();
        const mid = new Date(Date.parse(start) + 45_000).toISOString();
        const later = new Date(Date.parse(start) + 90_000).toISOString();
        await route.accept({
            type: 'segment', machine, name: 'on', start_time: start, end_time: mid, duration: 45
        });
        await route.accept({
            type: 'segment', machine, name: 'on', start_time: start, end_time: later, duration: 0
        });
        const row = sink.rows.get(`${machine}|${start}`);
        assert.strictEqual(row.duration, 0, 'pending heartbeat did not reopen the silence-closed segment');
    });

    it('advances pending end_time on heartbeat without inventing a new start', async function() {
        const sink = upsertSink();
        const closer = { close() { return Promise.resolve(); } };
        const route = segmentDispatch(sink, { accept() { return Promise.resolve(); } }, upsertSink(), closer);
        const machine = `ičt-${Math.random().toString(36).slice(2)}`;
        const start = new Date(1_700_100_000_000 + Math.floor(Math.random() * 1e8)).toISOString();
        const mid = new Date(Date.parse(start) + 20_000).toISOString();
        await route.accept({
            type: 'segment', machine, name: 'on', start_time: start, end_time: start, duration: 0
        });
        await route.accept({
            type: 'segment', machine, name: 'on', start_time: start, end_time: mid, duration: 0
        });
        assert.strictEqual(sink.rows.size, 1, 'heartbeat invented a second segment row');
        assert.strictEqual(
            sink.rows.get(`${machine}|${start}`).end_time,
            mid,
            'heartbeat did not advance pending end_time'
        );
    });
});
