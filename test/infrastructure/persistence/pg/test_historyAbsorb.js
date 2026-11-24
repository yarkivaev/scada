import assert from 'assert';
import { readFileSync } from 'node:fs';
import historyAbsorb, { historyDedupe } from '../../../../src/infrastructure/persistence/pg/historyAbsorb.js';

function phase(name, start, end, tags) {
    return {
        kind: 'phase',
        name,
        start_time: new Date(start).toISOString(),
        end_time: new Date(end).toISOString(),
        duration: (end - start) / 1000,
        tags: JSON.stringify(tags),
        properties: null
    };
}

function fakeClient(rows) {
    const state = { rows: rows.map((row) => { return { ...row }; }), deleted: [] };
    return {
        state,
        async query(sql, params) {
            if (/SELECT/u.test(sql)) {
                return { rows: state.rows };
            }
            state.deleted = params[1];
            const gone = new Set(params[1].map((value) => { return new Date(value).getTime(); }));
            state.rows = state.rows.filter((row) => {
                return !gone.has(new Date(row.start_time).getTime());
            });
            return { rowCount: state.deleted.length };
        }
    };
}

describe('historyAbsorb', function () {
    it('drops the inner start of overlapping unsplit heatings', async function () {
        const origin = 1_702_200_000_000 + Math.floor(Math.random() * 1e8);
        const inner = origin + 24_079;
        const finish = origin + 36_000;
        const stored = [
            phase('on', origin, finish, ['heating']),
            phase('on', inner, finish, ['heating'])
        ];
        const client = fakeClient(stored);
        await historyAbsorb(client, 'печь-α', [phase('on', inner, finish, [])]);
        assert.deepEqual(client.state.deleted, [stored[1].start_time],
            'the inner overlapping heating start stayed in storage');
    });
    it('commits folded rows instead of the raw later stream', function () {
        const body = readFileSync(new URL('../../../../src/infrastructure/persistence/pg/history.js', import.meta.url), 'utf8');
        assert.match(body, /const folded = await historyAbsorb\(client, machine, segments\)/u,
            'history commit still inserted the raw later stream');
    });
    it('drops covered unsplit duplicates after the furnace insert', function () {
        const body = readFileSync(new URL('../../../../src/infrastructure/persistence/pg/history.js', import.meta.url), 'utf8');
        assert.match(body, /await historyDedupe\(client, machine, span\(segments\)\)/u,
            'history commit still left a later heating inside an earlier host');
    });
    it('deletes a stored empty start that fold dropped', async function () {
        const origin = 1_702_840_000_000 + Math.floor(Math.random() * 1e8);
        const cover = phase('off', origin + 100, origin + 5_000, []);
        const tagged = phase('off', origin, origin + 15_000, ['to_ladle'], { split_of: String(origin) });
        const client = fakeClient([cover]);
        await historyAbsorb(client, 'печь-α', [tagged]);
        assert.deepEqual(client.state.deleted, [cover.start_time],
            'a fully covered empty start stayed in storage');
    });
    it('does not scan unsplit phases outside the batch span', async function () {
        const origin = 1_702_700_000_000 + Math.floor(Math.random() * 1e8);
        const finish = origin + 15_791;
        const calls = [];
        const client = {
            async query(sql, params) {
                calls.push({ sql, params });
                return { rows: [], rowCount: 0 };
            }
        };
        await historyDedupe(client, 'печь-α', { start: origin, end: finish });
        assert.equal(calls.every((item) => {
            return item.params[1].getTime() === origin && item.params[2].getTime() === finish;
        }), true, 'dedupe still scanned unsplit phases outside the batch span');
    });
    it('selects machine with overlapping stored phases', async function () {
        const origin = 1_702_900_000_000 + Math.floor(Math.random() * 1e8);
        const calls = [];
        const client = {
            async query(sql) {
                calls.push(sql);
                return { rows: [], rowCount: 0 };
            }
        };
        await historyAbsorb(client, `печь-${Math.random()}`, [phase('off', origin, origin + 4_000, [])]);
        assert.match(calls[0], /SELECT[^;]*\bmachine\b/u,
            'absorb still loaded stored phases without machine');
    });
    it('loads stored phases against incoming windows not the convex hull', async function () {
        const origin = 1_703_000_000_000 + Math.floor(Math.random() * 1e8);
        const calls = [];
        const client = {
            async query(sql, params) {
                calls.push({ sql, params });
                return { rows: [], rowCount: 0 };
            }
        };
        await historyAbsorb(client, `печь-${Math.random()}`, [
            phase('off', origin, origin + 2_000, []),
            phase('on', origin + 3_600_000, origin + 3_602_000, ['нагрев'])
        ]);
        const starts = calls[0].params[1];
        assert.equal(Array.isArray(starts) && starts.length === 2, true,
            'absorb still scanned the convex hull between disjoint incoming windows');
    });
    it('does not merge abutting incoming windows into one hull', async function () {
        const origin = 1_703_100_000_000 + Math.floor(Math.random() * 1e8);
        const calls = [];
        const client = {
            async query(sql, params) {
                calls.push({ sql, params });
                return { rows: [], rowCount: 0 };
            }
        };
        await historyAbsorb(client, `печь-${Math.random()}`, [
            phase('off', origin, origin + 2_000, []),
            phase('on', origin + 2_000, origin + 5_000, ['нагрев'])
        ]);
        assert.equal(calls[0].params[1].length, 2,
            'abutting windows were still fused into a hull');
    });
    it('loads a duration-zero covering tail even when the latest predecessor has closed', async function() {
        const origin = 1_703_200_000_000 + Math.floor(Math.random() * 1e8);
        const calls = [];
        const client = {
            async query(sql) {
                calls.push(sql);
                return { rows: [], rowCount: 0 };
            }
        };
        await historyAbsorb(client, `печь-${Math.random()}`, [phase('on', origin + 3_600_000, origin + 3_602_000, ['нагрев'])]);
        assert.match(calls[0], /duration\s*=\s*0/u,
            'absorb still missed the live duration-zero tail behind a closed predecessor');
    });
});
