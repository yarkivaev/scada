import assert from 'assert';
import foldingSegments from '../../../../src/infrastructure/ingest/sinks/foldingSegments.js';

function phase(name, start, end, tags, properties) {
    return {
        machine: 'icht4',
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
    const state = { rows: rows.map((row) => { return { ...row }; }), written: [] };
    const overlap = /start_time<\$3/u;
    return {
        state,
        async query(sql, params) {
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
    it('does not keep an empty covering off beside a tagged ladle split', async function () {
        const origin = 1_702_500_000_000 + Math.floor(Math.random() * 1e8);
        const cover = phase('off', origin, origin + 15_000, []);
        const pour = phase('off', origin + 700, origin + 15_000, ['to_ladle'], { split_of: String(origin) });
        const db = store([cover]);
        await foldingSegments(db, db).write([pour]);
        assert.equal(db.state.rows.length === 1 && db.state.rows[0].tags, JSON.stringify(['to_ladle']),
            'an empty covering off stayed in storage beside a tagged ladle split');
    });
    it('does not leave overlapping offs after an empty stream then a ladle split', async function () {
        const origin = 1_702_600_000_000 + Math.floor(Math.random() * 1e8);
        const cover = phase('off', origin, origin + 15_000, []);
        const pour = phase('off', origin + 700, origin + 15_000, ['to_ladle'], { split_of: String(origin) });
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
});
