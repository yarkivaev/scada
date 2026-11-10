/** Forget a first choice only once both its history window and its raw metric are gone. */
export default async function retainMetricReceipts(pool, days) {
    const table = await pool.query("SELECT to_regclass('metric_receipts') AS receipts");
    if (!table.rows?.[0]?.receipts) { return; }
    await pool.query(`DELETE FROM metric_receipts r
        WHERE r.ts < NOW() - make_interval(days => greatest($1::integer, COALESCE((SELECT max(retention_days) FROM history_topics),30)))
        AND NOT EXISTS(SELECT 1 FROM metrics m WHERE m.topic=r.topic AND m.ts=r.ts)`, [days]);
}
