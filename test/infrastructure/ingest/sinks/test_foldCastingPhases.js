import assert from 'assert';
import foldCastingPhases from '../../../../src/infrastructure/ingest/sinks/foldCastingPhases.js';

function phase(machine, name, start, end, tags) {
    return {
        machine,
        kind: 'phase',
        name,
        start_time: new Date(start).toISOString(),
        end_time: new Date(end).toISOString(),
        duration: (end - start) / 1000,
        tags: JSON.stringify(tags),
        properties: null,
        options: null,
        resolved: false
    };
}

function instant(row) {
    return new Date(row.start_time).getTime();
}

function overlap(left, right) {
    return instant(left) < Date.parse(right.end_time) && instant(right) < Date.parse(left.end_time);
}

function fakePool(rowsByMachine, failures) {
    const seen = [];
    const written = [];
    let remaining = failures;
    const pool = {
        seen,
        written,
        async query(sql, params) {
            seen.push({ sql, params });
            if (/SELECT DISTINCT machine/u.test(sql)) {
                return { rows: Object.keys(rowsByMachine).map((machine) => { return { machine }; }) };
            }
            return { rows: [], rowCount: 0 };
        },
        async connect() {
            const stored = new Map(Object.entries(rowsByMachine).map(([machine, rows]) => {
                return [machine, rows.map((row) => { return { ...row }; })];
            }));
            return {
                async query(sql, params) {
                    seen.push({ sql, params });
                    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
                        return { rows: [], rowCount: 0 };
                    }
                    if (/pg_advisory_xact_lock/u.test(sql)) {
                        return { rows: [], rowCount: 0 };
                    }
                    if (/SELECT .* FROM segments/u.test(sql) && /machine\s*=\s*\$1/u.test(sql)) {
                        return { rows: stored.get(params[0]) ?? [] };
                    }
                    if (/DELETE FROM segments/u.test(sql)) {
                        const machine = params[0];
                        const gone = new Set((params[1] ?? []).map((value) => { return new Date(value).getTime(); }));
                        stored.set(machine, (stored.get(machine) ?? []).filter((row) => {
                            return !gone.has(instant(row));
                        }));
                        return { rowCount: gone.size };
                    }
                    if (/INSERT INTO segments/u.test(sql)) {
                        if (remaining > 0) {
                            remaining -= 1;
                            const error = new Error('deadlock detected');
                            error.code = '40P01';
                            throw error;
                        }
                        written.push({ sql, params });
                        return { rowCount: 1 };
                    }
                    return { rows: [], rowCount: 0 };
                },
                release() {
                    return undefined;
                }
            };
        }
    };
    return pool;
}

describe('foldCastingPhases', function () {
    it('clips a covering empty off around later ons on a casting machine', async function () {
        const origin = 1_704_000_000_000 + Math.floor(Math.random() * 1e8);
        const machine = 'cm7';
        const pool = fakePool({
            [machine]: [
                phase(machine, 'off', origin, origin + 20_000, []),
                phase(machine, 'on', origin + 5_000, origin + 8_000, []),
                phase(machine, 'on', origin + 12_000, origin + 15_000, [])
            ]
        });
        await foldCastingPhases(pool);
        const upserted = pool.written.map((item) => {
            return {
                start_time: item.params[3],
                end_time: item.params[4],
                duration: item.params[5]
            };
        });
        const names = pool.written.map((item) => { return item.params[2]; });
        const crossed = upserted.some((left, i) => {
            return upserted.slice(i + 1).some((right) => { return overlap(left, right); });
        });
        assert.equal(names.includes('on') && names.includes('off') && crossed === false, true,
            'casting repair still left ons inside the covering off');
    });

    it('does not reopen a completed last casting span as live', async function () {
        const origin = 1_704_300_000_000 + Math.floor(Math.random() * 1e8);
        const machine = `cm${1 + Math.floor(Math.random() * 8)}`;
        const pool = fakePool({
            [machine]: [
                phase(machine, 'off', origin, origin + 20_000, []),
                phase(machine, 'on', origin + 5_000, origin + 8_000, []),
                phase(machine, 'on', origin + 12_000, origin + 15_000, [])
            ]
        });
        await foldCastingPhases(pool);
        const live = pool.written.some((item) => { return item.params[5] === 0; });
        assert.equal(live, false, 'casting repair still reopened the last completed span');
    });

    it('does not read or write icht furnaces', async function () {
        const origin = 1_704_100_000_000 + Math.floor(Math.random() * 1e8);
        const pool = fakePool({
            icht1: [phase('icht1', 'off', origin, origin + 8_000, [])]
        });
        pool.query = async function query(sql, params) {
            pool.seen.push({ sql, params });
            if (/SELECT DISTINCT machine/u.test(sql)) {
                assert.match(sql, /LIKE 'cm%'/u, 'casting repair still selected furnaces outside cm*');
                return { rows: [] };
            }
            return { rows: [], rowCount: 0 };
        };
        await foldCastingPhases(pool);
        const touched = pool.seen.some((item) => {
            return JSON.stringify(item.params ?? []).includes('icht1') || /icht1/u.test(item.sql);
        });
        assert.equal(touched, false, 'casting repair still touched an icht furnace');
    });

    it('retries a deadlock while folding a casting machine', async function () {
        const origin = 1_704_200_000_000 + Math.floor(Math.random() * 1e8);
        const machine = `cm${1 + Math.floor(Math.random() * 8)}`;
        const pool = fakePool({
            [machine]: [
                phase(machine, 'off', origin, origin + 12_000, []),
                phase(machine, 'on', origin + 3_000, origin + 6_000, [])
            ]
        }, 2);
        await foldCastingPhases(pool);
        assert.equal(pool.written.length > 0, true, 'casting repair still aborted after a deadlock');
    });
});
