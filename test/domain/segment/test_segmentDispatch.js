import assert from 'assert';
import segmentDispatch from '../../../src/domain/segment/dispatch.js';

function fakeCloser() {
    const calls = [];
    return {
        calls,
        close(machine, start) {
            calls.push({ machine, start });
            return Promise.resolve();
        }
    };
}

function fakeSink() {
    const written = [];
    return {
        written,
        write(records) {
            written.push(...records);
            return Promise.resolve();
        }
    };
}

describe('segmentDispatch', function() {
    it('routes retag records to retag sink', async function() {
        const retagged = [];
        const retag = { accept(record) { retagged.push(record); return Promise.resolve(); } };
        const route = segmentDispatch(fakeSink(), retag, fakeSink(), fakeCloser());
        await route.accept({ type: 'retag', machine: `ičt-${Math.random()}`, start_time: '2024-01-01T00:00:00.000Z' });
        assert.strictEqual(retagged.length, 1, 'retag record was not routed to retag sink');
    });

    it('routes split records to split sink', async function() {
        const split = fakeSink();
        const route = segmentDispatch(fakeSink(), { accept() { return Promise.resolve(); } }, split, fakeCloser());
        await route.accept({ type: 'split', machine: `ičt-${Math.random()}`, start_time: '2024-01-01T00:00:00.000Z' });
        assert.strictEqual(split.written.length, 1, 'split record was not routed to split sink');
    });

    it('routes segment records to segment sink', async function() {
        const segment = fakeSink();
        const route = segmentDispatch(segment, { accept() { return Promise.resolve(); } }, fakeSink(), fakeCloser());
        await route.accept({ type: 'segment', machine: `ičt-${Math.random()}`, start_time: '2024-01-01T00:00:00.000Z', duration: 60 });
        assert.strictEqual(segment.written.length, 1, 'segment record was not routed to segment sink');
    });

    it('closes orphan open segments before writing a new open segment', async function() {
        const closer = fakeCloser();
        const segment = fakeSink();
        const machine = `ičt-${Math.random()}`;
        const start = new Date(Math.floor(Math.random() * 1e12)).toISOString();
        const route = segmentDispatch(segment, { accept() { return Promise.resolve(); } }, fakeSink(), closer);
        await route.accept({ type: 'segment', machine, start_time: start, duration: 0 });
        assert.strictEqual(closer.calls.length, 1, 'open segment write did not close orphan rows first');
    });

    it('does not close orphan rows before writing a completed segment', async function() {
        const closer = fakeCloser();
        const segment = fakeSink();
        const route = segmentDispatch(segment, { accept() { return Promise.resolve(); } }, fakeSink(), closer);
        await route.accept({ type: 'segment', machine: `ičt-${Math.random()}`, start_time: '2024-01-01T00:00:00.000Z', duration: 45 });
        assert.strictEqual(closer.calls.length, 0, 'completed segment write must not close orphan rows');
    });

    it('throws when segment command type is unknown', async function() {
        const route = segmentDispatch(fakeSink(), { accept() { return Promise.resolve(); } }, fakeSink(), fakeCloser());
        await assert.rejects(
            () => { return route.accept({ type: `тип-${Math.random()}`, machine: 'icht1', start_time: '2024-01-01T00:00:00.000Z' }); },
            /Segment command type .* is not defined/u,
            'unknown segment command type did not throw'
        );
    });

    it('throws when segment command type is missing', async function() {
        const route = segmentDispatch(fakeSink(), { accept() { return Promise.resolve(); } }, fakeSink(), fakeCloser());
        await assert.rejects(
            () => { return route.accept({ machine: 'icht1', start_time: '2024-01-01T00:00:00.000Z' }); },
            /Segment command type .* is not defined/u,
            'missing segment command type did not throw'
        );
    });
});
