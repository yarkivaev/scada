import processingErrorLog from '../processingErrorLog.js';

/**
 * Closes stale open segment rows for one machine before a new open segment lands.
 *
 * @param {object} pool - pg Pool with query() method
 * @returns {object} closer with close(machine, startTime, kind)
 *
 * @example
 *   const closer = closeOrphanOpen(pool);
 *   await closer.close('m1', '2024-01-01T00:00:00.000Z', 'phase');
 */
export default function closeOrphanOpen(pool) {
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('Pool must have a query() method');
    }
    return {
        async close(machine, startTime, kind) {
            const track = kind || 'phase';
            try {
                await pool.query(
                    `UPDATE segments
                     SET end_time = start_time + interval '1 second', duration = 1
                     WHERE machine = $1 AND kind = $3 AND duration = 0 AND start_time <> $2`,
                    [machine, startTime, track]
                );
            } catch (error) {
                processingErrorLog('close_orphan_open', error, { machine, startTime, kind: track });
                throw error;
            }
        }
    };
}
