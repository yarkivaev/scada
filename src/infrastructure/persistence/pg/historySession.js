/** Owns a history transaction with an optional statement deadline. */
export default async function historySession(pool, action, timeoutMs, required = false) {
    if (!required && (!timeoutMs || typeof pool.connect !== 'function')) { return action(pool); }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (timeoutMs) { await client.query("SELECT set_config('statement_timeout', $1, true)", [String(timeoutMs)]); }
        const result = await action(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}
