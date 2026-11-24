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

    it('replaces a split family through the pool', async function() {
        const seen = [];
        const client = {
            query(text) {
                seen.push(text);
                return Promise.resolve({});
            },
            release() {}
        };
        const route = segmentDispatch(fakeSink(), { accept() { return Promise.resolve(); } }, fakeSink(), fakeCloser(), {
            connect() { return Promise.resolve(client); }
        });
        await route.accept({
            type: 'split-family',
            machine: `ičt-${Math.random()}`,
            origin: Date.now(),
            pieces: [{ start_time: new Date().toISOString(), machine: 'm', kind: 'phase', name: 'off' }]
        });
        assert.ok(seen.some(function (row) { return String(row).includes('DELETE'); }), 'family replace did not delete');
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

    it('passes the incoming name so a covering same-name open is not closed', async function() {
        const closer = {
            calls: [],
            close(machine, start, kind, runner, name) {
                this.calls.push({ machine, start, kind, runner, name });
                return Promise.resolve();
            }
        };
        const label = `off-${Math.random().toString(36).slice(2, 8)}`;
        const route = segmentDispatch(fakeSink(), { accept() { return Promise.resolve(); } }, fakeSink(), closer);
        await route.accept({
            type: 'segment',
            machine: `ičt-${Math.random()}`,
            start_time: new Date(Math.floor(Math.random() * 1e12)).toISOString(),
            duration: 0,
            name: label
        });
        assert.strictEqual(closer.calls[0].name, label, 'orphan close did not receive the incoming segment name');
    });

    it('runs orphan close and upsert in one transaction when pool is supplied', async function() {
        const steps = [];
        const client = {
            query(sql) {
                steps.push(String(sql).split(/\s+/u)[0]);
                return Promise.resolve({});
            },
            release() {
                steps.push('RELEASE');
            }
        };
        const pool = {
            connect() {
                return Promise.resolve(client);
            }
        };
        const closer = {
            calls: [],
            close(machine, start, kind, runner) {
                this.calls.push({ machine, start, kind, runner });
                return runner.query('UPDATE orphans');
            }
        };
        const segment = {
            written: [],
            write(records, runner) {
                this.written.push(...records);
                return runner.query('INSERT segments');
            }
        };
        const route = segmentDispatch(segment, { accept() { return Promise.resolve(); } }, fakeSink(), closer, pool);
        const start = new Date(Math.floor(Math.random() * 1e12)).toISOString();
        await route.accept({
            type: 'segment',
            machine: `ičt-${Math.random()}`,
            start_time: start,
            duration: 0,
            kind: 'phase'
        });
        assert.deepStrictEqual(steps, ['BEGIN', 'UPDATE', 'INSERT', 'COMMIT', 'RELEASE'],
            'pending heartbeat did not use a single transaction');
    });

    it('closes orphan rows before writing a completed segment', async function() {
        const closer = fakeCloser();
        const segment = fakeSink();
        const route = segmentDispatch(segment, { accept() { return Promise.resolve(); } }, fakeSink(), closer);
        await route.accept({ type: 'segment', machine: `ičt-${Math.random()}`, start_time: '2024-01-01T00:00:00.000Z', duration: 45, name: 'on' });
        assert.strictEqual(closer.calls.length, 1, 'completed segment write still left the previous open tail');
    });

    it('writes a heartbeat as a point at its start', async function() {
        const segment = fakeSink();
        const origin = 1_700_000_000_000 + Math.floor(Math.random() * 1e8);
        const start = new Date(origin).toISOString();
        const route = segmentDispatch(segment, { accept() { return Promise.resolve(); } }, fakeSink(), fakeCloser());
        await route.accept({
            type: 'segment',
            machine: `печь-${Math.random()}`,
            start_time: start,
            end_time: new Date(origin + 8_000).toISOString(),
            duration: 0,
            name: 'off'
        });
        assert.equal(segment.written[0].end_time === start && segment.written[0].duration === 0, true,
            'heartbeat still stored a growing interval instead of a point');
    });

    it('throws when segment command type is unknown', async function() {
        const route = segmentDispatch(fakeSink(), { accept() { return Promise.resolve(); } }, fakeSink(), fakeCloser());
        await assert.rejects(
            () => { return route.accept({ type: `type-${Math.random()}`, machine: 'm1', start_time: '2024-01-01T00:00:00.000Z' }); },
            /Segment command type .* is not defined/u,
            'unknown segment command type did not throw'
        );
    });

    it('throws when segment command type is missing', async function() {
        const route = segmentDispatch(fakeSink(), { accept() { return Promise.resolve(); } }, fakeSink(), fakeCloser());
        await assert.rejects(
            () => { return route.accept({ machine: 'm1', start_time: '2024-01-01T00:00:00.000Z' }); },
            /Segment command type .* is not defined/u,
            'missing segment command type did not throw'
        );
    });

    it('closes orphans once for a repeated heartbeat start', async function() {
        const closer = fakeCloser();
        const route = segmentDispatch(fakeSink(), { accept() { return Promise.resolve(); } }, fakeSink(), closer);
        const machine = `печь-${Math.random()}`;
        const origin = 1_700_000_000_000 + Math.floor(Math.random() * 1e8);
        const start = new Date(origin).toISOString();
        await route.acceptMany([1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
            return {
                type: 'segment', machine, kind: 'phase', name: 'on',
                start_time: start, end_time: new Date(origin + i * 800).toISOString(),
                duration: 0, tags: '[]', properties: '{}'
            };
        }));
        assert.equal(closer.calls.length, 1, 'heartbeat batch still closed orphans once per raw message');
    });
    it('writes one row for abutting heartbeats of the same name', async function() {
        const segment = fakeSink();
        const route = segmentDispatch(segment, { accept() { return Promise.resolve(); } }, fakeSink(), fakeCloser());
        const machine = `печь-${Math.random()}`;
        const origin = 1_700_000_000_000 + Math.floor(Math.random() * 1e8);
        await route.acceptMany([1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
            return {
                type: 'segment', machine, kind: 'phase', name: 'on',
                start_time: new Date(origin + (i - 1) * 800).toISOString(),
                end_time: new Date(origin + i * 800).toISOString(),
                duration: 0, tags: '[]', properties: '{}'
            };
        }));
        assert.equal(segment.written.length, 1, 'abutting heartbeats still wrote a row per sample start');
    });
    it('writes one folded row for a repeated heartbeat start', async function() {
        const segment = fakeSink();
        const route = segmentDispatch(segment, { accept() { return Promise.resolve(); } }, fakeSink(), fakeCloser());
        const machine = `ковш-${Math.random()}`;
        const origin = 1_700_000_000_000 + Math.floor(Math.random() * 1e8);
        const start = new Date(origin).toISOString();
        await route.acceptMany([1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
            return {
                type: 'segment', machine, kind: 'phase', name: 'off',
                start_time: start, end_time: new Date(origin + i * 900).toISOString(),
                duration: 0, tags: '[]', properties: '{}'
            };
        }));
        assert.equal(segment.written.length, 1, 'heartbeat batch still wrote every raw STOMP row');
    });
    it('writes a batch of segments in one sink call', async function() {
        let writes = 0;
        const segment = {
            write(records) {
                writes += 1;
                return Promise.resolve(records);
            }
        };
        const route = segmentDispatch(segment, { accept() { return Promise.resolve(); } }, fakeSink(), fakeCloser());
        const machine = `печь-${Math.random()}`;
        await route.acceptMany([
            { type: 'segment', machine, start_time: '2024-01-01T00:00:00.000Z', duration: 60 },
            { type: 'segment', machine, start_time: '2024-01-01T00:02:00.000Z', duration: 45 }
        ]);
        assert.equal(writes, 1, 'a batch of segments still folded one record at a time');
    });

    it('flushes buffered segments before a split in the same batch', async function() {
        const order = [];
        const segment = { write(records) { order.push(`seg:${records.length}`); return Promise.resolve(); } };
        const split = { write(records) { order.push(`split:${records.length}`); return Promise.resolve(); } };
        const route = segmentDispatch(segment, { accept() { return Promise.resolve(); } }, split, fakeCloser());
        const machine = `ковш-${Math.random()}`;
        await route.acceptMany([
            { type: 'segment', machine, start_time: '2024-01-01T00:00:00.000Z', duration: 12 },
            { type: 'split', machine, start_time: '2024-01-01T00:01:00.000Z' },
            { type: 'segment', machine, start_time: '2024-01-01T00:02:00.000Z', duration: 18 }
        ]);
        assert.deepEqual(order, ['seg:1', 'split:1', 'seg:1'],
            'a split was folded into the surrounding segment batch');
    });
});
