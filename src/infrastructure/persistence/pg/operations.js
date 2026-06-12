function upsertOperation(pool, item) {
    return pool.query(
        `INSERT INTO operations (
            machine, occurred_at, kind, key, payload
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (key) DO UPDATE SET
            machine = EXCLUDED.machine,
            occurred_at = EXCLUDED.occurred_at,
            kind = EXCLUDED.kind,
            payload = EXCLUDED.payload`,
        [
            item.machine,
            item.occurred_at,
            item.kind,
            item.key,
            item.payload
        ]
    );
}

function listForMachine(pool, machineId, kind, range) {
    let sql = `SELECT machine, occurred_at, kind, key, payload
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

/**
 * PostgreSQL operations persistence port for generic machine operations.
 *
 * @param {object} pool - pg pool
 * @returns {object} operations port with upsert and listForMachine
 *
 * @example
 *   const store = operationStatePg(pool);
 *   await store.upsert({ machine: 'icht1', key: 'nb-1', kind: 'chem', ... });
 */
export default function operationStatePg(pool) {
    return {
        upsert(item) {
            return upsertOperation(pool, item);
        },
        listForMachine(machineId, kind, range) {
            return listForMachine(pool, machineId, kind, range);
        }
    };
}
