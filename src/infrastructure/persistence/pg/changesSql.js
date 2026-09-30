/**
 * Level changes for one Postgres metrics topic, including the held start.
 *
 * $1 topic, $2 start, $3 inclusive end. The sample before start seeds lag.
 *
 * @returns {string} SQL
 */
export default function changesSql() {
    return `WITH prior AS (
            SELECT ts, value FROM metrics
            WHERE topic = $1 AND ts < $2
            ORDER BY ts DESC LIMIT 1
        ), windowed AS (
            SELECT ts, value FROM metrics
            WHERE topic = $1 AND ts >= $2 AND ts <= $3
        ), series AS (
            SELECT ts, value FROM prior
            UNION ALL
            SELECT ts, value FROM windowed
        ), marked AS (
            SELECT ts, value,
                   LAG(value) OVER (ORDER BY ts) AS prev,
                   ROW_NUMBER() OVER (ORDER BY ts) AS n
            FROM series
        )
        SELECT CASE WHEN ts < $2 THEN $2 ELSE ts END AS ts, value
        FROM marked
        WHERE n = 1 OR value IS DISTINCT FROM prev
        ORDER BY ts`;
}
