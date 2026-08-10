async function upsertOperation(pool, item) {
    const existing = await pool.query('SELECT 1 FROM operations WHERE key = $1', [item.key]);
    await pool.query(
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
    return { created: existing.rows.length === 0 };
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

function missing(machineId, key) {
    return new Error(`operation '${key}' not found for machine '${machineId}'`);
}

async function getOperation(pool, machineId, key) {
    const result = await pool.query(
        `SELECT machine, occurred_at, kind, key, payload
        FROM operations WHERE machine = $1 AND key = $2`,
        [machineId, key]
    );
    if (result.rows.length === 0) {
        throw missing(machineId, key);
    }
    return result.rows[0];
}

async function removeOperation(pool, machineId, key) {
    const result = await pool.query(
        `DELETE FROM operations WHERE machine = $1 AND key = $2
        RETURNING machine, occurred_at, kind, key, payload`,
        [machineId, key]
    );
    if (result.rows.length === 0) {
        throw missing(machineId, key);
    }
    return result.rows[0];
}

/**
 * PostgreSQL operations persistence port for generic machine operations.
 *
 * @param {object} pool - pg pool
 * @returns {object} operations port with upsert, get, remove, and listForMachine
 *
 * @example
 *   const store = operationStatePg(pool);
 *   await store.upsert({ machine: 'm1', key: 'nb-1', kind: 'chem', ... });
 *   await store.remove('m1', 'nb-1');
 */
export default function operationStatePg(pool) {
    return {
        upsert(item) {
            return upsertOperation(pool, item);
        },
        get(machineId, key) {
            return getOperation(pool, machineId, key);
        },
        remove(machineId, key) {
            return removeOperation(pool, machineId, key);
        },
        listForMachine(machineId, kind, range) {
            return listForMachine(pool, machineId, kind, range);
        }
    };
}
