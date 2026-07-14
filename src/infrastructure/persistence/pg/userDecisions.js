/**
 * PostgreSQL user_decisions read port for central site-server.
 * Implements list(machine, start) for segment audit chronology.
 *
 * @param {object} pool - pg pool
 * @returns {object} catalog with async list(machine, start)
 *
 * @example
 *   const catalog = userDecisionsFromPg(pool);
 *   const rows = await catalog.list('icht1', new Date('2024-06-01T12:00:00.000Z'));
 */
export default function userDecisionsFromPg(pool) {
    return {
        async list(machine, start) {
            const result = await pool.query(
                `SELECT username, operator_id, decided_at, payload
                 FROM user_decisions
                 WHERE machine = $1 AND start_time = $2
                 ORDER BY decided_at ASC NULLS LAST`,
                [machine, start]
            );
            return result.rows.map((row) => {
                const item = {
                    username: row.username,
                    decidedAt: row.decided_at,
                    payload: row.payload
                };
                if (row.operator_id !== undefined && row.operator_id !== null) {
                    item.operatorId = row.operator_id;
                }
                return item;
            });
        }
    };
}
