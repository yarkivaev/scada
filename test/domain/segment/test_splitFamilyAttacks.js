import assert from 'assert';
import { checkSplit, replaceSplit, splitRows } from '../../../src/domain/segment/splitFamily.js';

function parent(start, end, duration) {
    return { name: 'off', start_time: start, end_time: end, duration };
}

function piece(start, end, tag, open) {
    return { start, end, tag, open: Boolean(open) };
}

function marked(row, originMillis) {
    if (row.properties === null || row.properties === undefined) {
        return false;
    }
    return JSON.parse(row.properties).split_of === originMillis;
}

function doomed(rows, params) {
    const machine = params[0];
    const originMs = new Date(params[1]).getTime();
    const originMillis = params[2];
    const kept = new Set(params[3].map((item) => {
        return new Date(item).getTime();
    }));
    return rows.filter((row) => {
        const startMs = new Date(row.start_time).getTime();
        if (row.machine !== machine || row.kind !== 'phase' || kept.has(startMs)) {
            return false;
        }
        return startMs === originMs || marked(row, originMillis);
    });
}

describe('checkSplit adversarial bounds', function() {
    it('rejects a parent that is not off', function() {
        const start = new Date('2026-10-19T06:02:18.137Z');
        const end = new Date(start.getTime() + 240000);
        assert.throws(function() {
            checkSplit({ name: 'on', start_time: start, end_time: end, duration: 240 }, [
                piece(start, end, 'шлак')
            ]);
        }, RangeError, 'a non-off parent was split');
    });

    it('rejects an empty split list', function() {
        const start = new Date('2026-10-19T06:02:18.137Z');
        const end = new Date(start.getTime() + 240000);
        assert.throws(function() {
            checkSplit(parent(start, end, 240), []);
        }, RangeError, 'an empty split was accepted');
    });

    it('rejects a piece that starts before the parent', function() {
        const start = new Date('2026-10-19T06:02:18.137Z');
        const earlier = new Date(start.getTime() - 120000);
        const end = new Date(start.getTime() + 240000);
        assert.throws(function() {
            checkSplit(parent(start, end, 240), [
                piece(earlier, start, 'шлак'),
                piece(start, end, 'шихта')
            ]);
        }, RangeError, 'a piece before the parent start was accepted');
    });

    it('rejects a one millisecond overlap', function() {
        const start = new Date('2026-10-19T06:02:18.137Z');
        const cut = new Date(start.getTime() + 120000);
        const overlap = new Date(cut.getTime() - 1);
        const end = new Date(start.getTime() + 360000);
        assert.throws(function() {
            checkSplit(parent(start, end, 360), [
                piece(start, cut, 'шлак'),
                piece(overlap, end, 'шихта')
            ]);
        }, RangeError, 'an overlapping split was accepted');
    });

    it('rejects a one millisecond gap', function() {
        const start = new Date('2026-10-19T06:02:18.137Z');
        const cut = new Date(start.getTime() + 120000);
        const later = new Date(cut.getTime() + 1);
        const end = new Date(start.getTime() + 360000);
        assert.throws(function() {
            checkSplit(parent(start, end, 360), [
                piece(start, cut, 'шлак'),
                piece(later, end, 'шихта')
            ]);
        }, RangeError, 'a one millisecond gap was accepted');
    });

    it('rejects a closed piece that lasts 59999 milliseconds', function() {
        const start = new Date('2026-10-19T06:02:18.137Z');
        const cut = new Date(start.getTime() + 59999);
        const end = new Date(start.getTime() + 240000);
        assert.throws(function() {
            checkSplit(parent(start, end, 240), [
                piece(start, cut, 'шлак'),
                piece(cut, end, 'шихта')
            ]);
        }, RangeError, 'a 59999 millisecond piece was accepted');
    });

    it('keeps a closed piece that lasts exactly 60 seconds', function() {
        const start = new Date('2026-10-19T06:02:18.137Z');
        const cut = new Date(start.getTime() + 60000);
        const end = new Date(start.getTime() + 240000);
        const ordered = checkSplit(parent(start, end, 240), [
            piece(start, cut, 'шлак'),
            piece(cut, end, '')
        ]);
        assert.strictEqual(ordered[0].end.getTime() - ordered[0].start.getTime(), 60000, 'a 60 second piece was refused');
    });

    it('rejects an open piece that is not the tail of a closed off', function() {
        const start = new Date('2026-10-19T06:02:18.137Z');
        const cut = new Date(start.getTime() + 120000);
        const end = new Date(start.getTime() + 360000);
        assert.throws(function() {
            checkSplit(parent(start, end, 360), [
                piece(start, cut, 'шлак', true),
                piece(cut, end, 'шихта')
            ]);
        }, RangeError, 'an open middle piece was accepted on a closed off');
    });

    it('rejects an open tail on a closed off', function() {
        const start = new Date('2026-10-19T06:02:18.137Z');
        const cut = new Date(start.getTime() + 120000);
        const end = new Date(start.getTime() + 360000);
        assert.throws(function() {
            checkSplit(parent(start, end, 360), [
                piece(start, cut, 'шлак'),
                piece(cut, end, '', true)
            ]);
        }, RangeError, 'an open tail was accepted on a closed off');
    });

    it('rejects a tail that runs past a closed off', function() {
        const start = new Date('2026-10-19T06:02:18.137Z');
        const cut = new Date(start.getTime() + 120000);
        const end = new Date(start.getTime() + 360000);
        const past = new Date(end.getTime() + 60000);
        assert.throws(function() {
            checkSplit(parent(start, end, 360), [
                piece(start, cut, 'шлак'),
                piece(cut, past, 'шихта')
            ]);
        }, RangeError, 'a tail past the closed off was accepted');
    });

    it('rejects a closed cover gap when parent duration is missing', function() {
        const start = new Date('2026-10-19T06:02:18.137Z');
        const cut = new Date(start.getTime() + 120000);
        const early = new Date(start.getTime() + 240000);
        const end = new Date(start.getTime() + 360000);
        assert.throws(function() {
            checkSplit(parent(start, end, undefined), [
                piece(start, cut, 'шлак'),
                piece(cut, early, 'шихта')
            ]);
        }, RangeError, 'a missing duration skipped closed cover');
    });

    it('rejects a closed cover gap when parent duration is null', function() {
        const start = new Date('2026-10-19T06:02:18.137Z');
        const cut = new Date(start.getTime() + 120000);
        const early = new Date(start.getTime() + 240000);
        const end = new Date(start.getTime() + 360000);
        assert.throws(function() {
            checkSplit(parent(start, end, null), [
                piece(start, cut, 'шлак'),
                piece(cut, early, 'шихта')
            ]);
        }, RangeError, 'null duration skipped closed cover');
    });

    it('allows a one millisecond open tail on a pending off', function() {
        const start = new Date('2026-10-19T06:02:18.137Z');
        const cut = new Date(start.getTime() + 120000);
        const tip = new Date(cut.getTime() + 1);
        const end = new Date(start.getTime() + 360000);
        const ordered = checkSplit(parent(start, end, 0), [
            piece(start, cut, 'шлак'),
            piece(cut, tip, '', true)
        ]);
        assert.strictEqual(ordered[1].open, true, 'a short open tail was refused on a pending off');
    });

    it('stores split_of as parent millis on the later piece when input is reversed', function() {
        const start = new Date('2026-10-19T06:02:18.137Z');
        const cut = new Date(start.getTime() + 120000);
        const end = new Date(start.getTime() + 360000);
        const rows = splitRows('ичт-π', checkSplit(parent(start, end, 360), [
            piece(cut, end, ''),
            piece(start, cut, 'шлак')
        ]));
        assert.strictEqual(
            JSON.parse(rows[1].properties).split_of,
            String(start.getTime()),
            'later piece split_of was not the parent millis string'
        );
    });
});

describe('replaceSplit adversarial delete', function() {
    it('drops the stale family start and keeps the neighbor that begins at the parent end', async function() {
        const start = new Date('2026-10-19T06:02:18.137Z');
        const stale = new Date(start.getTime() + 90000);
        const cut = new Date(start.getTime() + 120000);
        const end = new Date(start.getTime() + 360000);
        const machine = `ичт-${Math.floor(Math.random() * 8000 + 2000)}`;
        const other = `печь-${Math.floor(Math.random() * 8000 + 2000)}`;
        const origin = String(start.getTime());
        const calls = [];
        const client = {
            query(text, params) {
                calls.push({ text: String(text), params });
                return Promise.resolve({ rowCount: 1 });
            },
            release() {}
        };
        const pieces = splitRows(machine, checkSplit(parent(start, end, 360), [
            piece(start, cut, 'шлак'),
            piece(cut, end, '')
        ]));
        await replaceSplit({
            connect() {
                return Promise.resolve(client);
            }
        }, { machine, origin: start.getTime(), pieces });
        const deleted = calls.find((call) => {
            return call.text.includes('DELETE FROM segments');
        });
        const rows = [
            { machine, kind: 'phase', name: 'off', start_time: start, properties: JSON.stringify({ split_of: origin }) },
            { machine, kind: 'phase', name: 'off', start_time: stale, properties: JSON.stringify({ split_of: origin }) },
            { machine, kind: 'phase', name: 'on', start_time: end, properties: JSON.stringify({ comment: 'split_of stays' }) },
            { machine: other, kind: 'phase', name: 'off', start_time: stale, properties: JSON.stringify({ split_of: origin }) }
        ];
        const gone = doomed(rows, deleted.params).map((row) => {
            return new Date(row.start_time).toISOString();
        });
        assert.deepStrictEqual(gone, [stale.toISOString()], 'replace deleted a neighbor that starts at the parent end');
    });
});
