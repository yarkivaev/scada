/**
 * Closes uncovered time between adjacent same-name segments that stayed
 * inside the continuity budget. Existing restart fragments then meet on
 * the timeline without deleting rows.
 *
 * @param {object} pool - pg pool
 * @param {number} budgetSeconds - maximum gap that still counts as continuous
 * @returns {Promise<void>}
 *
 * @example
 *   await abutSegments(pool, 30);
 */
export default async function abutSegments(pool, budgetSeconds) {
    await pool.query(
        `UPDATE segments AS left_row
         SET end_time = right_row.start_time,
             duration = EXTRACT(EPOCH FROM (right_row.start_time - left_row.start_time))
         FROM segments AS right_row
         WHERE left_row.machine = right_row.machine
           AND left_row.kind = right_row.kind
           AND left_row.name = right_row.name
           AND left_row.duration > 0
           AND right_row.start_time > left_row.end_time
           AND right_row.start_time - left_row.end_time <= make_interval(secs => $1)
           AND right_row.start_time = (
               SELECT MIN(next.start_time)
               FROM segments AS next
               WHERE next.machine = left_row.machine
                 AND next.kind = left_row.kind
                 AND next.start_time > left_row.start_time
           )`,
        [budgetSeconds]
    );
}
