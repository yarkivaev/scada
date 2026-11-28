import assert from 'assert';
import foldingSegments from '../../../../src/infrastructure/ingest/sinks/foldingSegments.js';

function phase(name, start, end, tags, properties) {
    return {
        machine: 'drive4',
        kind: 'phase',
        name,
        start_time: new Date(start).toISOString(),
        end_time: new Date(end).toISOString(),
        duration: (end - start) / 1000,
        tags: JSON.stringify(tags),
        properties: properties ? JSON.stringify(properties) : null
    };
}

function store(rows) {
    let chain = Promise.resolve();
    const locks = [];
    const state = { rows: rows.map((row) => { return { ...row }; }), written: [], sqls: [], params: [] };
    const overlap = /unnest|start_time<\$3/u;
    return {
        state,
        async query(sql, params) {
            state.sqls.push(sql);
            state.params.push(params ?? []);
            if (/pg_advisory_xact_lock/u.test(sql)) {
                const previous = chain;
                chain = new Promise((resolve) => { locks.push(resolve); });
                await previous;
                return { rows: [], rowCount: 0 };
            }
            if (/COMMIT|ROLLBACK/u.test(sql)) {
                locks.shift()?.();
                return { rows: [], rowCount: 0 };
            }
            if (/BEGIN/u.test(sql)) {
                return { rows: [], rowCount: 0 };
            }
            if (/SELECT/u.test(sql) && overlap.test(sql)) {
                return { rows: state.rows };
            }
            if (/start_time = ANY/u.test(sql)) {
                const gone = new Set(params[1].map((value) => { return new Date(value).getTime(); }));
                state.rows = state.rows.filter((row) => {
                    return !gone.has(new Date(row.start_time).getTime());
                });
                return { rowCount: gone.size };
            }
            return { rows: [], rowCount: 0 };
        },
        async connect() {
            return this;
        },
        release() {
            return undefined;
        },
        write(records) {
            state.written.push(...records);
            for (const record of records) {
                const start = new Date(record.start_time).getTime();
                state.rows = state.rows.filter((row) => {
                    return new Date(row.start_time).getTime() !== start;
                });
                state.rows.push(record);
            }
            return Promise.resolve();
        }
    };
}

function overlaps(left, right) {
    return Date.parse(left.start_time) < Date.parse(right.end_time)
        && Date.parse(right.start_time) < Date.parse(left.end_time)
        && left.start_time !== right.end_time
        && right.start_time !== left.end_time;
}

describe('foldingSegments', function () {
    it('does not keep an empty covering off over a tagged ladle split', async function () {
        const origin = 1_702_500_000_000 + Math.floor(Math.random() * 1e8);
        const cover = phase('off', origin, origin + 15_000, []);
        const pour = phase('off', origin + 700, origin + 15_000, ['inspection'], { split_of: String(origin) });
        const db = store([cover]);
        await foldingSegments(db, db).write([pour]);
        const tagged = db.state.rows.find((row) => { return row.tags === JSON.stringify(['inspection']); });
        const crossed = db.state.rows.some((left, i) => {
            return db.state.rows.slice(i + 1).some((right) => { return overlaps(left, right); });
        });
        assert.equal(Boolean(tagged) && crossed === false, true,
            'an empty covering off stayed over a tagged ladle split');
    });
    it('does not leave overlapping offs after an empty stream then a ladle split', async function () {
        const origin = 1_702_600_000_000 + Math.floor(Math.random() * 1e8);
        const cover = phase('off', origin, origin + 15_000, []);
        const pour = phase('off', origin + 700, origin + 15_000, ['inspection'], { split_of: String(origin) });
        const db = store([]);
        const sink = foldingSegments(db, db);
        await sink.write([cover]);
        await sink.write([pour]);
        const rows = db.state.rows.filter((row) => { return row.name === 'off'; });
        const crossed = rows.some((left, i) => {
            return rows.slice(i + 1).some((right) => { return overlaps(left, right); });
        });
        assert.equal(crossed, false, 'empty off and tagged ladle split still overlapped after both writes');
    });
    it('keeps exclusive empty tails after a nested tagged write', async function () {
        const origin = 1_702_850_000_000 + Math.floor(Math.random() * 1e8);
        const cover = phase('off', origin, origin + 15_000, []);
        const tagged = phase('off', origin + 700, origin + 4_000, ['inspection']);
        const db = store([cover]);
        await foldingSegments(db, db).write([tagged]);
        const start = Math.min(...db.state.rows.map((row) => { return Date.parse(row.start_time); }));
        const finish = Math.max(...db.state.rows.map((row) => { return Date.parse(row.end_time); }));
        assert.equal(start === origin && finish === origin + 15_000, true,
            'a nested tagged write dropped exclusive empty tails');
    });
    it('locks history for a machine before folding', async function () {
        const origin = 1_702_860_000_000 + Math.floor(Math.random() * 1e8);
        const db = store([]);
        await foldingSegments(db, db).write([phase('off', origin, origin + 1_000, ['простой-α'])]);
        assert.match(db.state.sqls.join('\n'), /pg_advisory_xact_lock/u,
            'foldingSegments still wrote without a history lock');
    });
    it('does not leave overlap after concurrent writes of different tagged offs', async function () {
        const origin = 1_702_870_000_000 + Math.floor(Math.random() * 1e8);
        const first = phase('off', origin, origin + 10_000, ['этап_а-ζ']);
        const second = phase('off', origin + 4_000, origin + 12_000, ['этап_б-ζ']);
        const db = store([]);
        const sink = foldingSegments(db, db);
        await Promise.all([sink.write([first]), sink.write([second])]);
        const crossed = db.state.rows.some((left, i) => {
            return db.state.rows.slice(i + 1).some((right) => { return overlaps(left, right); });
        });
        assert.equal(crossed, false, 'concurrent tagged offs still overlapped after both writes');
    });
    it('does not self-join unsplit hosts after folding a batch', async function () {
        const origin = 1_702_910_000_000 + Math.floor(Math.random() * 1e8);
        const db = store([]);
        await foldingSegments(db, db).write([phase('off', origin, origin + 2_000, ['простой-β'])]);
        assert.equal(db.state.sqls.some((sql) => { return /UPDATE segments AS host/u.test(sql); }), false,
            'ingest fold still ran historyDedupe on every batch');
    });
    it('writes one row when a batch repeats the same start', async function () {
        const origin = 1_702_920_000_000 + Math.floor(Math.random() * 1e8);
        const first = phase('on', origin, origin + 1_000, ['нагрев-γ']);
        const later = phase('on', origin, origin + 4_000, ['нагрев-γ']);
        const db = store([]);
        await foldingSegments(db, db).write([first, later]);
        const same = db.state.written.filter((row) => { return Date.parse(row.start_time) === origin; });
        assert.equal(same.length, 1, 'a batch still upserted the same start twice');
    });
    it('collapses an incoming heartbeat batch before loading stored phases', async function () {
        const origin = 1_702_930_000_000 + Math.floor(Math.random() * 1e8);
        const db = store([]);
        const batch = [1, 2, 3, 4, 5, 6, 7, 8].map((step) => {
            return phase('on', origin, origin + step * 500, ['нагрев-δ']);
        });
        await foldingSegments(db, db).write(batch);
        const index = db.state.sqls.findIndex((sql) => { return /unnest/u.test(sql); });
        assert.equal(index >= 0 && db.state.params[index][1].length === 1, true,
            'stored overlap lookup still ran once per raw STOMP row');
    });
});
