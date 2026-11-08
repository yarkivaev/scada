import centralPolicy from './centralPolicy.js';

/** Disabling a previously active durable ingest needs an explicit data migration. */
export default async function centralTelemetryPreflight(env, pool) {
    const policy = centralPolicy(env.CENTRAL_TELEMETRY_POLICY ?? {});
    if (policy.enabled || !pool?.query) { return; }
    const table = await pool.query("SELECT to_regclass('central_metric_receipts') AS receipts");
    if (!table.rows[0]?.receipts) { return; }
    const accepted = await pool.query('SELECT 1 FROM central_metric_receipts LIMIT 1');
    if (accepted.rows.length) {
        throw new Error('Central telemetry policy cannot be disabled after durable admission; re-enable it to drain pending data');
    }
}
