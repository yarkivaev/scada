const GAP_SQL = `UPDATE segments AS left_row
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
           AND next_row.next_start - left_row.end_time <= make_interval(secs => $1)`;

const ABSORB_SQL = `UPDATE segments AS left_row
         SET end_time = CASE
                 WHEN next_row.next_duration = 0 THEN next_row.next_end
                 WHEN next_row.next_end > left_row.end_time THEN next_row.next_end
                 ELSE left_row.end_time
             END,
             duration = CASE
                 WHEN next_row.next_duration = 0 THEN 0
                 ELSE EXTRACT(EPOCH FROM (
                     CASE
                         WHEN next_row.next_end > left_row.end_time THEN next_row.next_end
                         ELSE left_row.end_time
                     END - left_row.start_time
                 ))
             END
         FROM (
             SELECT machine, kind, start_time, name, end_time, duration,
                    lead(start_time) OVER (PARTITION BY machine, kind ORDER BY start_time) AS next_start,
                    lead(name) OVER (PARTITION BY machine, kind ORDER BY start_time) AS next_name,
                    lead(end_time) OVER (PARTITION BY machine, kind ORDER BY start_time) AS next_end,
                    lead(duration) OVER (PARTITION BY machine, kind ORDER BY start_time) AS next_duration
             FROM segments
         ) AS next_row
         WHERE left_row.machine = next_row.machine
           AND left_row.kind = next_row.kind
           AND left_row.start_time = next_row.start_time
           AND left_row.name = next_row.next_name
           AND next_row.next_start > left_row.start_time
           AND next_row.next_start <= left_row.end_time + make_interval(secs => $1)`;

const COLLAPSE_SQL = `DELETE FROM segments AS later
         USING (
             SELECT machine, kind, name, end_time,
                    lead(start_time) OVER (PARTITION BY machine, kind ORDER BY start_time) AS next_start,
                    lead(name) OVER (PARTITION BY machine, kind ORDER BY start_time) AS next_name
             FROM segments
         ) AS pair
         WHERE later.machine = pair.machine
           AND later.kind = pair.kind
           AND later.start_time = pair.next_start
           AND pair.name = pair.next_name
           AND pair.next_start <= pair.end_time + make_interval(secs => $1)`;

/**
 * Closes uncovered time between adjacent same-name segments that stayed
 * inside the continuity budget, then collapses the later overlapping
 * same-name fragment into the earlier start.
 *
 * @param {object} pool - pg pool
 * @param {number} budgetSeconds - maximum gap that still counts as continuous
 * @returns {Promise<void>}
 *
 * @example
 *   await abutSegments(pool, 30);
 */
export default async function abutSegments(pool, budgetSeconds) {
    await pool.query(GAP_SQL, [budgetSeconds]);
    await pool.query(ABSORB_SQL, [budgetSeconds]);
    await pool.query(COLLAPSE_SQL, [budgetSeconds]);
}
