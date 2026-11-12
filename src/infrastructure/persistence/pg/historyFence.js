/** Start of the furnace bucket that can still receive observations, in milliseconds. */
export default async function historyFence(pool, machine) {
    const result = await pool.query(`SELECT floor(extract(epoch FROM clock_timestamp())*1000 / bucket) * bucket AS open_ms
        FROM (SELECT COALESCE((SELECT bucket_ms FROM history_topics WHERE machine=$1 LIMIT 1), 30000) AS bucket) sizes`, [machine]);
    return Number(result.rows[0].open_ms);
}
