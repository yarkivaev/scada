import processingErrorLog from '../processingErrorLog.js';

/**
 * Closes open segment rows whose last known end is older than a wall-clock silence budget.
 * Does not insert a replacement Started row.
 *
 * @param {object} pool - pg Pool with query() method
 * @returns {object} closer with close(budgetSeconds)
 *
 * @example
 *   const closer = closeSilentOpen(pool);
 *   await closer.close(30);
 */
export default function closeSilentOpen(pool) {
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('Pool must have a query() method');
    }
    return {
        async close(budgetSeconds) {
            try {
                await pool.query(
                    `UPDATE segments
                     SET end_time = CASE
                           WHEN end_time <= start_time THEN start_time + interval '1 second'
                           ELSE end_time
                         END,
                         duration = GREATEST(
                           1,
                           EXTRACT(EPOCH FROM (
                             CASE
                               WHEN end_time <= start_time THEN start_time + interval '1 second'
                               ELSE end_time
                             END - start_time
                           ))
                         )
                     WHERE duration = 0
                       AND end_time < NOW() - make_interval(secs => $1)`,
                    [budgetSeconds]
                );
            } catch (error) {
                processingErrorLog('close_silent_open', error, { budgetSeconds });
                throw error;
            }
        }
    };
}
