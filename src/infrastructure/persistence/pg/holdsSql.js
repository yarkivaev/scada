/**
 * Coverage holds of one Postgres metrics topic.
 *
 * $1 topic, $2 start, $3 exclusive end, $4 gap milliseconds.
 *
 * @returns {string} SQL
 */
export default function holdsSql() {
    return `WITH windowed AS (
            SELECT ts, value FROM metrics
            WHERE topic = $1 AND ts >= $2 AND ts < $3
        ), lagged AS (
            SELECT ts, value,
                   LAG(ts) OVER (ORDER BY ts) AS prev_ts,
                   LAG(value) OVER (ORDER BY ts) AS prev
            FROM windowed
        ), flagged AS (
            SELECT ts, value,
                   CASE WHEN prev IS NULL
                         OR value IS DISTINCT FROM prev
                         OR (EXTRACT(EPOCH FROM (ts - prev_ts)) * 1000) > $4
                        THEN 1 ELSE 0 END AS fresh
            FROM lagged
        ), grouped AS (
            SELECT ts, value, SUM(fresh) OVER (ORDER BY ts) AS grp
            FROM flagged
        )
        SELECT MIN(ts) AS ts, MAX(ts) AS until, MIN(value) AS value
        FROM grouped
        GROUP BY grp
        ORDER BY ts`;
}
