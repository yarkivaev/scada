export const sourceId = 'local-clickhouse-raw-v1';

const migrationRequired = 'Explicit history source identity migration required before ClickHouse activation';

export async function assertSource(pool, machine, initialize = false) {
    const result = await pool.query('SELECT source_id,time_scale FROM history_sources WHERE machine=$1', [machine]);
    if (!result.rowCount && initialize) {
        const previous = await pool.query(`SELECT 1 FROM history_work WHERE machine=$1
            UNION ALL SELECT 1 FROM history_observations WHERE machine=$1 LIMIT 1`, [machine]);
        if (previous.rowCount) { throw new Error(migrationRequired); }
        await pool.query('INSERT INTO history_sources(machine,source_id,time_scale) VALUES($1,$2,1000)', [machine, sourceId]);
        return;
    }
    if (result.rows[0]?.source_id !== sourceId || result.rows[0]?.time_scale !== 1000) {
        throw new Error(migrationRequired);
    }
}

export async function assertSources(pool) {
    const result = await pool.query(`SELECT 1 FROM history_topics t LEFT JOIN history_sources s ON s.machine=t.machine
        WHERE s.source_id IS DISTINCT FROM $1 OR s.time_scale IS DISTINCT FROM 1000 LIMIT 1`, [sourceId]);
    if (result.rowCount) { throw new Error(migrationRequired); }
}

/** A durable backend floor survives loss of the pruning session and cannot move backwards. */
export async function retentionFloor(pool) {
    const result = await pool.query('SELECT retained_from FROM history_retention WHERE source_id=$1', [sourceId]);
    return result.rowCount ? Number(result.rows[0].retained_from) : -Number.MAX_SAFE_INTEGER;
}

/** ClickHouse cannot scan from an empty or negative sentinel floor. */
export function usableCutoff(floor) {
    return Number.isSafeInteger(floor) && floor >= 0 ? floor : null;
}
