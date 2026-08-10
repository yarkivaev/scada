/**
 * PostgreSQL alert hydration port for supervisor-sink and plant STOMP alerts.
 *
 * @param {object} pool - pg pool
 * @returns {object} alerts port with listUnacknowledged
 *
 * @example
 *   const store = alertsStatePg(pool);
 *   const rows = await store.listUnacknowledged({ machine: 'm1' });
 */
export default function alertsStatePg(pool) {
    return {
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
