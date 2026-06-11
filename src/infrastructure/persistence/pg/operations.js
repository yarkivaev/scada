function upsertOperation(pool, item) {
    return pool.query(
        `INSERT INTO operations (
            machine, occurred_at, kind, external_key, payload,
            source_updated_at, source_id, ingested_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (external_key) DO UPDATE SET
            machine = EXCLUDED.machine,
            occurred_at = EXCLUDED.occurred_at,
            kind = EXCLUDED.kind,
            payload = EXCLUDED.payload,
            source_updated_at = EXCLUDED.source_updated_at,
            source_id = EXCLUDED.source_id,
            ingested_at = EXCLUDED.ingested_at`,
        [
            item.machine,
            item.occurred_at,
            item.kind,
            item.external_key,
            item.payload,
            item.source_updated_at,
            item.source_id,
            item.ingested_at
        ]
    );
}

function listForMachine(pool, machineId, kind, range) {
    let sql = `SELECT machine, occurred_at, kind, external_key, payload,
        source_updated_at, source_id, ingested_at
        FROM operations WHERE machine = $1 AND kind = $2`;
    const prm = [machineId, kind];
    if (range.from) {
        prm.push(range.from);
        sql += ` AND occurred_at >= $${prm.length}`;
    }
    if (range.to) {
        prm.push(range.to);
        sql += ` AND occurred_at <= $${prm.length}`;
    }
    sql += ' ORDER BY occurred_at';
    return pool.query(sql, prm).then((result) => {
        return result.rows;
    });
}

function latestSourceUpdatedAt(pool, machineId, kind) {
    return pool.query(
        `SELECT MAX(source_updated_at) AS source_updated_at
         FROM operations WHERE machine = $1 AND kind = $2`,
        [machineId, kind]
    ).then((result) => {
        return result.rows[0].source_updated_at ?? null;
    });
}

/**
 * PostgreSQL operations persistence port for generic external machine results.
 *
 * @param {object} pool - pg pool
 * @returns {object} operations port with upsert, listForMachine, latestSourceUpdatedAt
 *
 * @example
 *   const store = operationStatePg(pool);
 *   await store.upsert({ machine: 'icht1', external_key: 'nb-1', kind: 'chem', ... });
 */
export default function operationStatePg(pool) {
    return {
        upsert(item) {
            return upsertOperation(pool, item);
        },
        listForMachine(machineId, kind, range) {
            return listForMachine(pool, machineId, kind, range);
        },
        latestSourceUpdatedAt(machineId, kind) {
            return latestSourceUpdatedAt(pool, machineId, kind);
        }
    };
}
