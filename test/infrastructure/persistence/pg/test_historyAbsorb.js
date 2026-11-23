import assert from 'assert';
import { readFileSync } from 'node:fs';
import historyAbsorb from '../../../../src/infrastructure/persistence/pg/historyAbsorb.js';

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
        assert.match(body, /await historyDedupe\(client, machine\)/u,
            'history commit still left a later heating inside an earlier host');
    });
});
