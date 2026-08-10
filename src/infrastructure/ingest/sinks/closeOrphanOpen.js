import processingErrorLog from '../processingErrorLog.js';

/**
 * Closes stale open segment rows for one machine before a new open segment lands.
 *
 * @param {object} pool - pg Pool with query() method
 * @returns {object} closer with close(machine, startTime)
 *
 * @example
 *   const closer = closeOrphanOpen(pool);
 *   await closer.close('m1', '2024-01-01T00:00:00.000Z');
 */
export default function closeOrphanOpen(pool) {
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('Pool must have a query() method');
    }
    return {
        async close(machine, startTime) {
            try {
                await pool.query(
                    `UPDATE segments
                     SET end_time = start_time + interval '1 second', duration = 1
                     WHERE machine = $1 AND duration = 0 AND start_time <> $2`,
                    [machine, startTime]
                );
            } catch (error) {
                processingErrorLog('close_orphan_open', error, { machine, startTime });
                throw error;
            }
        }
    };
}
