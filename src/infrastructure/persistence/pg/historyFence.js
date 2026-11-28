/** Start of the active bucket that can still receive observations, in the work time unit. */
export default async function historyFence(pool, machine, timeScale = 1) {
    if (![1, 1000].includes(timeScale)) { throw new TypeError('External history supports millisecond or microsecond coordinates'); }
    const result = await pool.query(`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000 * $2 / bucket) * bucket AS open_ms
        FROM (SELECT COALESCE((SELECT bucket_ms FROM history_topics WHERE machine=$1 LIMIT 1), 30000 * $2) AS bucket) sizes`, [machine, timeScale]);
    return Number(result.rows[0].open_ms);
}
