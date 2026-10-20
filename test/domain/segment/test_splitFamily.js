import assert from 'assert';
import { checkSplit, familyCover, replaceSplit, splitRows } from '../../../src/domain/segment/splitFamily.js';

function parent(start, end, duration) {
    return { name: 'off', start_time: start, end_time: end, duration };
}

function piece(start, end, tag, open) {
    return { start: new Date(start), end: new Date(end), tag, open: Boolean(open) };
}

describe('checkSplit', function() {
    it('keeps an untagged piece when another piece has a reason', function() {
        const start = new Date('2026-10-19T06:02:18.000Z');
        const cut = new Date('2026-10-19T06:25:00.000Z');
        const end = new Date('2026-10-19T06:47:06.000Z');
        const ordered = checkSplit(parent(start, end, 2690), [
            piece(start, cut, ''),
            piece(cut, end, 'шлак')
        ]);
        assert.strictEqual(ordered[0].tag, '', 'untagged piece was dropped');
    });

    it('rejects a family with no reason at all', function() {
        const start = new Date('2026-10-19T06:02:18.000Z');
        const cut = new Date('2026-10-19T06:25:00.000Z');
        const end = new Date('2026-10-19T06:47:06.000Z');
        assert.throws(function() {
            checkSplit(parent(start, end, 2690), [piece(start, cut, ''), piece(cut, end, '')]);
        }, RangeError, 'untagged family was accepted');
    });

    it('keeps a closed piece shorter than one minute', function() {
        const start = new Date('2026-10-19T06:02:18.000Z');
        const cut = new Date(start.getTime() + 30000);
        const end = new Date('2026-10-19T06:47:06.000Z');
        const ordered = checkSplit(parent(start, end, 2690), [
            piece(start, cut, 'шлак'),
            piece(cut, end, 'шихта')
        ]);
        assert.strictEqual(ordered[0].end.getTime() - ordered[0].start.getTime(), 30000, 'a 30 second piece was refused');
    });

    it('rejects a gap between pieces', function() {
        const start = new Date('2026-10-19T06:02:18.000Z');
        const cut = new Date('2026-10-19T06:25:00.000Z');
        const later = new Date('2026-10-19T06:26:00.000Z');
        const end = new Date('2026-10-19T06:47:06.000Z');
        assert.throws(function() {
            checkSplit(parent(start, end, 2690), [piece(start, cut, 'шлак'), piece(later, end, 'шихта')]);
        }, RangeError, 'gapped split was accepted');
    });

    it('rejects a closed off that stops before the original end', function() {
        const start = new Date('2026-10-19T06:02:18.000Z');
        const cut = new Date('2026-10-19T06:25:00.000Z');
        const early = new Date('2026-10-19T06:40:00.000Z');
        const end = new Date('2026-10-19T06:47:06.000Z');
        assert.throws(function() {
            checkSplit(parent(start, end, 2690), [piece(start, cut, 'шлак'), piece(cut, early, 'шихта')]);
        }, RangeError, 'partial cover of a closed off was accepted');
    });

    it('allows an open tail on a pending off', function() {
        const start = new Date('2026-10-19T06:02:18.000Z');
        const cut = new Date('2026-10-19T06:25:00.000Z');
        const now = new Date('2026-10-19T06:47:06.000Z');
        const ordered = checkSplit(parent(start, now, 0), [
            piece(start, cut, 'шлак'),
            piece(cut, now, '', true)
        ]);
        assert.strictEqual(ordered[1].open, true, 'open tail was closed');
    });

    it('rejects an open piece that is not the tail', function() {
        const start = new Date('2026-10-19T06:02:18.000Z');
        const cut = new Date('2026-10-19T06:25:00.000Z');
        const end = new Date('2026-10-19T06:47:06.000Z');
        assert.throws(function() {
            checkSplit(parent(start, end, 0), [
                piece(start, cut, 'шлак', true),
                piece(cut, end, 'шихта')
            ]);
        }, RangeError, 'open middle piece was accepted');
    });

    it('stores split_of as the original start in millis', function() {
        const start = new Date('2026-10-19T06:02:18.000Z');
        const end = new Date('2026-10-19T06:47:06.000Z');
        const rows = splitRows('ичт-2', [piece(start, end, 'шлак')]);
        assert.strictEqual(JSON.parse(rows[0].properties).split_of, String(start.getTime()), 'split_of was not the parent millis');
    });
});

describe('familyCover', function() {
    it('spans stored pieces from the original start through the latest end', function() {
        const start = new Date('2026-10-19T06:02:18.400Z');
        const cut = new Date('2026-10-19T06:25:00.000Z');
        const end = new Date('2026-10-19T06:47:06.700Z');
        const cover = familyCover([
            { name: 'off', start_time: start, end_time: cut, duration: '1361.6' },
            { name: 'off', start_time: cut, end_time: end, duration: '1326.7' }
        ]);
        assert.deepStrictEqual({
            start: cover.start_time.getTime(),
            end: cover.end_time.getTime(),
            duration: cover.duration
        }, {
            start: start.getTime(),
            end: end.getTime(),
            duration: (end.getTime() - start.getTime()) / 1000
        }, 'family cover kept the shortened first piece');
    });
});

describe('replaceSplit', function() {
    it('deletes obsolete family starts and upserts the new pieces on one client', async function() {
        const sql = [];
        const client = {
            query(text) {
                sql.push(text);
                return Promise.resolve({ rowCount: 1 });
            },
            release() {
                sql.push('release');
            }
        };
        const pool = { connect() { return Promise.resolve(client); } };
        const start = new Date('2026-10-19T06:02:18.000Z');
        const cut = new Date('2026-10-19T06:25:00.000Z');
        const end = new Date('2026-10-19T06:47:06.000Z');
        const pieces = splitRows('ичт-2', checkSplit(parent(start, end, 2690), [
            piece(start, cut, 'шлак'),
            piece(cut, end, '')
        ]));
        await replaceSplit(pool, { machine: 'ичт-2', origin: start.getTime(), pieces });
        assert.ok(sql.some(function (row) { return row.includes('DELETE FROM segments'); }), 'obsolete pieces were not deleted');
        assert.strictEqual(sql.filter(function (row) { return row.includes('INSERT INTO segments'); }).length, 2, 'both pieces were not upserted');
    });

    it('refuses an empty piece list before opening a transaction', async function() {
        let opened = false;
        const pool = {
            connect() {
                opened = true;
                return Promise.resolve({ query() {}, release() {} });
            }
        };
        let refused = false;
        try {
            await replaceSplit(pool, { machine: 'ичт-9', origin: 1729321338000, pieces: [] });
        } catch (err) {
            refused = err instanceof RangeError;
        }
        assert.deepStrictEqual({ refused, opened }, { refused: true, opened: false }, 'an empty split opened a transaction');
    });
});
