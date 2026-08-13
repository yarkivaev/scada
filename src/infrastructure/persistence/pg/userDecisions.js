/**
 * PostgreSQL user_decisions port for segment and operation audit.
 *
 * list(machine, start) returns segment chronology.
 * listByKey(machine, key) returns operation chronology by payload.key.
 * insert writes one audit row.
 *
 * @param {object} pool - pg pool
 * @returns {object} catalog with list, listByKey, insert
 *
 * @example
 *   const catalog = userDecisionsFromPg(pool);
 *   await catalog.insert({
 *     machine: 'm1', startTime: new Date(), username: 'Ivan',
 *     decidedAt: new Date(), payload: { kind: 'operation_op', verb: 'create', key: 'op:m1:1' }
 *   });
 */
function mapRow(row) {
    const item = {
        username: row.username,
        decidedAt: row.decided_at,
        payload: row.payload
    };
    if (row.operator_id !== undefined && row.operator_id !== null) {
        item.operatorId = row.operator_id;
    }
    return item;
}

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
            return result.rows.map(mapRow);
        },
        async listByKey(machine, key) {
            const result = await pool.query(
                `SELECT username, operator_id, decided_at, payload
                 FROM user_decisions
                 WHERE machine = $1
                   AND (payload::jsonb->>'key') = $2
                 ORDER BY decided_at ASC NULLS LAST`,
                [machine, key]
            );
            return result.rows.map(mapRow);
        },
        async insert(row) {
            const payload = typeof row.payload === 'string'
                ? row.payload
                : JSON.stringify(row.payload);
            await pool.query(
                `INSERT INTO user_decisions
                 (machine, start_time, username, operator_id, decided_at, payload)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    row.machine,
                    row.startTime,
                    row.username,
                    row.operatorId ?? null,
                    row.decidedAt,
                    payload
                ]
            );
        }
    };
}
