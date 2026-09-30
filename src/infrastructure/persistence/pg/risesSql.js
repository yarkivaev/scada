/**
 * Prefix sum of 0→1 edges for one Postgres metrics topic.
 *
 * $1 topic, $2 start, $3 exclusive end. The sample before start seeds lag.
 *
 * @returns {string} SQL
 */
export default function risesSql() {
    return `WITH prior AS (
            SELECT ts, value FROM metrics
            WHERE topic = $1 AND ts < $2
            ORDER BY ts DESC LIMIT 1
        ), windowed AS (
            SELECT ts, value FROM metrics
            WHERE topic = $1 AND ts >= $2 AND ts < $3
        ), series AS (
            SELECT ts, value FROM prior
            UNION ALL
            SELECT ts, value FROM windowed
        ), marked AS (
            SELECT ts, value, LAG(value) OVER (ORDER BY ts) AS prev
            FROM series
        )
        SELECT marked.ts AS ts,
               SUM(1) OVER (ORDER BY marked.ts) AS value
        FROM marked
        WHERE marked.ts >= $2 AND marked.prev = 0 AND marked.value = 1
        ORDER BY marked.ts`;
}
