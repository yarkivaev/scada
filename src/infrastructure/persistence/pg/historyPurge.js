import retainMetricReceipts from '../../ingest/db/retainMetricReceipts.js';
import pgHistorySession from './historySession.js';

export default function historyPurge(pool, cutoff, retentionDays, batch) {
    if (!batch) {
        return pool.query(`DELETE FROM history_observations o WHERE time_ms < $1
            AND NOT EXISTS (SELECT 1 FROM history_work w WHERE w.machine=o.machine
                AND (o.time_ms BETWEEN w.from_ms-86400000 AND greatest(w.until_ms,COALESCE(w.end_ms,w.until_ms))+86400000
                OR (o.time_ms<w.from_ms-86400000 AND NOT EXISTS (SELECT 1 FROM history_observations anchor
                    WHERE anchor.machine=o.machine AND anchor.channel=o.channel AND anchor.time_ms>o.time_ms AND anchor.time_ms<w.from_ms-86400000))))
            AND EXISTS (SELECT 1 FROM history_observations newer WHERE newer.machine=o.machine
                AND newer.channel=o.channel AND newer.time_ms>o.time_ms AND newer.time_ms<$1)`, [cutoff]).then(async (result) => {
            await retainMetricReceipts(pool, retentionDays);
            return result.rowCount;
        });
    }
    return pgHistorySession(pool, async (client) => {
        const pending = await client.query('SELECT 1 FROM history_work WHERE from_ms < $1 LIMIT 1', [cutoff]);
        if (pending.rowCount) { return { deferred: 'pending work' }; }
        const result = await client.query(`DELETE FROM history_observations WHERE ctid IN (
            SELECT ctid FROM history_observations WHERE time_ms < $1 ORDER BY machine, time_ms LIMIT $2
        )`, [cutoff, batch]);
        await retainMetricReceipts(client, retentionDays);
        return result.rowCount;
    }, 20000);
}
