/**
 * Builds a filtered alerts SELECT.
 *
 * @param {object} filters - optional machine, from, to
 * @returns {{sql: string, prm: Array}} query
 *
 * @example
 *   listSql({ machine: 'm1', from: start, to: end });
 */
function listSql(filters) {
    const prm = [];
    const clauses = [];
    const scope = filters || {};
    if (scope.machine) {
        prm.push(scope.machine);
        clauses.push(`machine = $${prm.length}`);
    }
    if (scope.from) {
        prm.push(scope.from);
        clauses.push(`"timestamp" >= $${prm.length}`);
    }
    if (scope.to) {
        prm.push(scope.to);
        clauses.push(`"timestamp" <= $${prm.length}`);
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`;
    return { prm, sql: `SELECT * FROM alerts${where} ORDER BY timestamp` };
}

/**
 * PostgreSQL alert hydration and range-read port.
 *
 * @param {object} pool - pg pool
 * @returns {object} alerts port with put, list, and listUnacknowledged
 *
 * @example
 *   const store = alertsStatePg(pool);
 *   const rows = await store.list({ machine: 'm1', from, to });
 */
export default function alertsStatePg(pool) {
    return {
        async put(row) {
            const existing = await pool.query(
                'SELECT id FROM alerts WHERE machine = $1 AND timestamp = $2 AND name = $3',
                [row.machine, row.timestamp, row.name]
            );
            if (existing.rows.length > 0) {
                return existing.rows[0];
            }
            const inserted = await pool.query(
                `INSERT INTO alerts (name, message, machine, severity, timestamp, acknowledged)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                [row.name, row.message, row.machine, row.severity, row.timestamp, row.acknowledged === true]
            );
            return inserted.rows[0];
        },
        async list(filters) {
            const query = listSql(filters);
            const result = await pool.query(query.sql, query.prm);
            return result.rows;
        },
        async listUnacknowledged(filters) {
            let sql = 'SELECT * FROM alerts WHERE acknowledged = FALSE';
            const prm = [];
            if (filters.machine) {
                prm.push(filters.machine);
                sql += ` AND machine = $${prm.length}`;
            }
            sql += ' ORDER BY id';
            const result = await pool.query(sql, prm);
            return result.rows;
        }
    };
}
