function intervalFor(days) {
    return `${days} days`;
}

async function deleteStale(pool, days) {
    const window = intervalFor(days);
    await pool.query('BEGIN');
    try {
        const metrics = await pool.query(
            'DELETE FROM metrics WHERE ts < NOW() - $1::interval',
            [window]
        );
        const segments = await pool.query(
            `DELETE FROM segments
             WHERE end_time > start_time
               AND end_time < NOW() - $1::interval`,
            [window]
        );
        const alerts = await pool.query(
            'DELETE FROM alerts WHERE "timestamp" < NOW() - $1::interval',
            [window]
        );
        const decisions = await pool.query(
            'DELETE FROM user_decisions WHERE start_time < NOW() - $1::interval',
            [window]
        );
        await pool.query('COMMIT');
        return {
            metrics: metrics.rowCount,
            segments: segments.rowCount,
            alerts: alerts.rowCount,
            userDecisions: decisions.rowCount
        };
    } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
    }
}

async function vacuumTables(pool) {
    const names = ['metrics', 'segments', 'alerts', 'user_decisions'];
    await Promise.all(names.map((name) => {
        return pool.query(`VACUUM ANALYZE ${name}`);
    }));
}

/**
 * Deletes Postgres rows older than the retention window and vacuums tables.
 *
 * @param {object} pool - pg.Pool instance
 * @param {number} days - retention window length in days
 * @returns {Promise<{retentionDays: number, deleted: object}>}
 */
export default async function runRetention(pool, days) {
    const deleted = await deleteStale(pool, days);
    await vacuumTables(pool);
    return { retentionDays: days, deleted };
}
