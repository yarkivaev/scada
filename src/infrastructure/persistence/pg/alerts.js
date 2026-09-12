/**
 * PostgreSQL alert hydration port for supervisor-sink and plant STOMP alerts.
 *
 * @param {object} pool - pg pool
 * @returns {object} alerts port with put and listUnacknowledged
 *
 * @example
 *   const store = alertsStatePg(pool);
 *   const rows = await store.listUnacknowledged({ machine: 'm1' });
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
