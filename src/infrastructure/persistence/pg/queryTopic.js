/**
 * Runs a topic SQL and maps ts/value rows.
 *
 * @param {object} pool - Postgres pool
 * @param {string} sql - query text
 * @param {Array} params - query params
 * @returns {Promise<Array<{ts: Date|string, value: number}>>} rows
 */
export default async function queryTopic(pool, sql, params) {
    const result = await pool.query(sql, params);
    return result.rows.map((row) => {
        const item = { ts: row.ts, value: Number(row.value) };
        if (row.until) {
            item.until = row.until;
        }
        return item;
    });
}
