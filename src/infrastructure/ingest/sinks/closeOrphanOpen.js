import processingErrorLog from '../processingErrorLog.js';

/**
 * Closes a previous different-name open and drops nested later opens
 * before a new pending heartbeat lands. A same-name covering open stays.
 *
 * @param {object} pool - pg Pool with query() method
 * @returns {object} closer with close(machine, startTime, kind, client?, name?)
 *
 * @example
 *   const closer = closeOrphanOpen(pool);
 *   await closer.close('m1', '2024-01-01T00:00:00.000Z', 'phase', null, 'off');
 */
export default function closeOrphanOpen(pool) {
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('Pool must have a query() method');
    }
    return {
        async close(machine, startTime, kind, client, name) {
            const track = kind || 'phase';
            const runner = client && typeof client.query === 'function' ? client : pool;
            try {
                await runner.query(
                    `WITH nested AS (
                         DELETE FROM segments
                         WHERE machine = $1 AND kind = $3 AND duration = 0 AND start_time > $2
                         RETURNING 1
                     )
                     UPDATE segments
                     SET end_time = $2::timestamptz,
                         duration = EXTRACT(EPOCH FROM ($2::timestamptz - start_time))
                     WHERE machine = $1 AND kind = $3 AND duration = 0 AND start_time < $2
                       AND name IS DISTINCT FROM $4`,
                    [machine, startTime, track, name ?? null]
                );
            } catch (error) {
                processingErrorLog('close_orphan_open', error, { machine, startTime, kind: track });
                throw error;
            }
        }
    };
}
