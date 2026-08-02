import assert from 'assert';
import segmentDispatch from '../../../src/domain/segment/dispatch.js';

/**
 * Fake UPSERT sink keyed by (machine, start_time).
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

/**
 * Applies the persistence effect of closeSilentOpen on one open row.
 */
function silenceClose(sink, machine, start) {
    const key = `${machine}|${start}`;
    const row = sink.rows.get(key);
    const span = Math.max(1, (Date.parse(row.end_time) - Date.parse(row.start_time)) / 1000);
    sink.rows.set(key, { ...row, duration: span });
}

function route(sink) {
    return segmentDispatch(sink, { accept() { return Promise.resolve(); } }, upsertSink(), {
        close() { return Promise.resolve(); }
    });
}

function openSegment(machine, start, end) {
    return {
        type: 'segment', machine, name: 'on',
        start_time: start, end_time: end, duration: 0
    };
}

describe('segmentDispatch reconnect after silence', function() {
    it('keeps an open segment growing across a short break without silence close', async function() {
        const sink = upsertSink();
        const dispatch = route(sink);
        const machine = `ičt-${Math.random().toString(36).slice(2)}`;
        const start = new Date(1_700_200_000_000 + Math.floor(Math.random() * 1e8)).toISOString();
        const mid = new Date(Date.parse(start) + 10_000).toISOString();
        const later = new Date(Date.parse(start) + 20_000).toISOString();
        await dispatch.accept(openSegment(machine, start, mid));
        await dispatch.accept(openSegment(machine, start, later));
        const row = sink.rows.get(`${machine}|${start}`);
        assert.strictEqual(row.duration, 0, 'short break closed the open segment');
        assert.strictEqual(row.end_time, later, 'short break did not keep the latest heartbeat end');
    });

    it('extends a silence-closed segment when the completed event arrives after a long break', async function() {
        const sink = upsertSink();
        const dispatch = route(sink);
        const machine = `ičt-${Math.random().toString(36).slice(2)}`;
        const start = new Date(1_700_300_000_000 + Math.floor(Math.random() * 1e8)).toISOString();
        const frozen = new Date(Date.parse(start) + 30_000).toISOString();
        const completed = new Date(Date.parse(start) + 120_000).toISOString();
        await dispatch.accept(openSegment(machine, start, frozen));
        silenceClose(sink, machine, start);
        await dispatch.accept({
            type: 'segment', machine, name: 'on',
            start_time: start, end_time: completed, duration: 120
        });
        const row = sink.rows.get(`${machine}|${start}`);
        assert.strictEqual(row.end_time, completed, 'long-break completed event did not extend end_time');
        assert.strictEqual(row.duration, 120, 'long-break completed event did not restore duration');
    });

    it('reopens a silence-closed segment when only a pending heartbeat is left after reconnect', async function() {
        const sink = upsertSink();
        const dispatch = route(sink);
        const machine = `ičt-${Math.random().toString(36).slice(2)}`;
        const start = new Date(1_700_400_000_000 + Math.floor(Math.random() * 1e8)).toISOString();
        const frozen = new Date(Date.parse(start) + 40_000).toISOString();
        const pending = new Date(Date.parse(start) + 55_000).toISOString();
        await dispatch.accept(openSegment(machine, start, frozen));
        silenceClose(sink, machine, start);
        await dispatch.accept(openSegment(machine, start, pending));
        const row = sink.rows.get(`${machine}|${start}`);
        assert.strictEqual(row.duration, 0, 'empty-queue reconnect did not reopen the segment');
        assert.strictEqual(row.end_time, pending, 'empty-queue reconnect did not advance end_time');
        assert.strictEqual(sink.rows.size, 1, 'empty-queue reconnect invented a new start_time');
    });

    it('drains a long backlog after silence close into the final continuous timeline', async function() {
        const sink = upsertSink();
        const dispatch = route(sink);
        const machine = `ičt-${Math.random().toString(36).slice(2)}`;
        const start = new Date(1_700_500_000_000 + Math.floor(Math.random() * 1e8)).toISOString();
        const frozen = new Date(Date.parse(start) + 25_000).toISOString();
        await dispatch.accept(openSegment(machine, start, frozen));
        silenceClose(sink, machine, start);
        const beats = [40, 55, 70, 85, 100].map((sec) => {
            return new Date(Date.parse(start) + sec * 1000).toISOString();
        });
        await beats.reduce((prior, end) => {
            return prior.then(() => { return dispatch.accept(openSegment(machine, start, end)); });
        }, Promise.resolve());
        const closedEnd = beats[beats.length - 1];
        await dispatch.accept({
            type: 'segment', machine, name: 'on',
            start_time: start, end_time: closedEnd, duration: 100
        });
        const nextStart = new Date(Date.parse(closedEnd) + 1000).toISOString();
        const nextEnd = new Date(Date.parse(nextStart) + 15_000).toISOString();
        await dispatch.accept({
            type: 'segment', machine, name: 'off',
            start_time: nextStart, end_time: nextEnd, duration: 15
        });
        const first = sink.rows.get(`${machine}|${start}`);
        const second = sink.rows.get(`${machine}|${nextStart}`);
        assert.strictEqual(first.end_time, closedEnd, 'backlog did not finish the silence-closed segment');
        assert.strictEqual(first.duration, 100, 'backlog did not apply the completed duration');
        assert.strictEqual(second.name, 'off', 'backlog did not insert the next segment after reconnect');
        assert.strictEqual(sink.rows.size, 2, 'backlog did not yield exactly two segment rows');
    });
});
