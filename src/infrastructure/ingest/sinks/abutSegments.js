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
         SET end_time = next_row.next_start,
             duration = EXTRACT(EPOCH FROM (next_row.next_start - left_row.start_time))
         FROM (
             SELECT machine, kind, start_time,
                    lead(start_time) OVER (PARTITION BY machine, kind ORDER BY start_time) AS next_start,
                    lead(name) OVER (PARTITION BY machine, kind ORDER BY start_time) AS next_name
             FROM segments
         ) AS next_row
         WHERE left_row.machine = next_row.machine
           AND left_row.kind = next_row.kind
           AND left_row.start_time = next_row.start_time
           AND left_row.duration > 0
           AND left_row.name = next_row.next_name
           AND next_row.next_start > left_row.end_time
           AND next_row.next_start - left_row.end_time <= make_interval(secs => $1)`,
        [budgetSeconds]
    );
}
