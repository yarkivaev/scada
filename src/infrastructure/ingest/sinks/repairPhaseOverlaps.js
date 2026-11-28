import historyFold from '../../../domain/segment/historyFold.js';
import processingErrorLog from '../processingErrorLog.js';

function startOf(row) {
    return new Date(row.start_time).getTime();
}

function pinLive(rows, preserveCoverage) {
    if (!rows.length) {
        return rows;
    }
    const ordered = [...rows].sort((left, right) => {
        return startOf(left) - startOf(right);
    });
    return ordered.map((row, i, all) => {
        const copy = { ...row };
        if (i === all.length - 1) {
            if (!preserveCoverage && copy.duration === 0) {
                copy.end_time = copy.start_time;
            }
            return copy;
        }
        if (copy.duration === 0) {
            copy.duration = Math.max(1, (Date.parse(copy.end_time) - Date.parse(copy.start_time)) / 1000);
        }
        return copy;
    });
}

async function loadPhases(runner, machine) {
    const stored = await runner.query(
        'SELECT machine,kind,name,start_time,end_time,duration,options,tags,properties,resolved,consumed FROM segments WHERE machine=$1 AND kind=\'phase\' ORDER BY start_time',
        [machine]
    );
    return stored.rows;
}

async function dropStarts(runner, machine, dropped) {
    if (!dropped.length) {
        return;
    }
    await runner.query(
        'DELETE FROM segments WHERE machine=$1 AND kind=\'phase\' AND start_time = ANY($2::timestamptz[])',
        [machine, dropped.map((row) => { return row.start_time; })]
    );
}

async function putPhase(runner, row) {
    await runner.query(
        `INSERT INTO segments (machine,kind,name,start_time,end_time,duration,options,tags,properties,resolved,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp())
         ON CONFLICT (machine,kind,start_time) DO UPDATE SET
           name=EXCLUDED.name,end_time=EXCLUDED.end_time,duration=EXCLUDED.duration,
           options=EXCLUDED.options,resolved=EXCLUDED.resolved,updated_at=EXCLUDED.updated_at`,
        [row.machine, row.kind || 'phase', row.name, row.start_time, row.end_time, row.duration,
            row.options, row.tags, row.properties, row.resolved]
    );
}

function foldRows(rows) {
    const size = 4;
    const groups = [];
    let offset = 0;
    while (offset < rows.length) {
        groups.push(rows.slice(offset, offset + size));
        offset += size;
    }
    return groups.reduce(async (prior, group) => {
        const acc = await prior;
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        return historyFold(acc, group);
    }, Promise.resolve([]));
}

async function foldMachine(runner, machine, preserveCoverage) {
    await runner.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`history:${machine}`]);
    const stored = await loadPhases(runner, machine);
    const folded = pinLive(await foldRows(stored), preserveCoverage);
    const kept = new Set(folded.map(startOf));
    await dropStarts(runner, machine, stored.filter((row) => {
        return !kept.has(startOf(row));
    }));
    await folded.reduce(async (prior, row) => {
        await prior;
        return putPhase(runner, row);
    }, Promise.resolve());
}

async function foldOwned(pool, machine, preserveCoverage) {
    if (typeof pool.connect !== 'function') {
        await foldMachine(pool, machine, preserveCoverage);
        return;
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await foldMachine(client, machine, preserveCoverage);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function foldOwnedRetry(pool, machine, attempt, preserveCoverage) {
    try {
        await foldOwned(pool, machine, preserveCoverage);
    } catch (error) {
        if (error?.code !== '40P01' || attempt >= 7) {
            throw error;
        }
        await new Promise((resolve) => {
            setTimeout(resolve, 40 * (attempt + 1));
        });
        await foldOwnedRetry(pool, machine, attempt + 1, preserveCoverage);
    }
}

/** Repairs overlapping phases on application-selected machines outside authoritative tracks. */
export default async function repairPhaseOverlaps(pool, machines = [], protectedTracks = [], { preserveCoverage = false } = {}) {
    const selected = [...new Set(machines)].filter((machine) => { return !protectedTracks.includes(machine); });
    await selected.reduce(async (prior, machine) => {
        await prior;
        try {
            await foldOwnedRetry(pool, machine, 0, preserveCoverage);
            process.stderr.write(`[supervisor-sink] folded overlapping phases for ${machine}\n`);
        } catch (error) {
            processingErrorLog('repair_phase_overlaps', error, { machine });
        }
    }, Promise.resolve());
}
