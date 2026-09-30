/**
 * Prefix sum of 0→1 edges for one ClickHouse metric topic.
 *
 * @example
 *   await clickhouseRises(conn, 'm1/flag', { start, end }, '');
 *
 * @param {object} connection - ClickHouse connection with query method
 * @param {string} topic - metric topic
 * @param {{start: Date, end: Date}} range - half-open window
 * @param {string} unit - measurement unit
 * @returns {Promise<Array<{timestamp: Date, value: number, unit: string}>>} prefixes
 */
function formatDateTime(date) {
    return date.toISOString().replace('Z', '').replace('T', ' ');
}

const RISES_SQL = `WITH prior AS (
    SELECT ts, value
    FROM scada.metrics
    WHERE topic = {topic:String} AND ts < {start:DateTime64(3)}
    ORDER BY ts DESC
    LIMIT 1
), windowed AS (
    SELECT ts, value
    FROM scada.metrics
    WHERE topic = {topic:String}
      AND ts >= {start:DateTime64(3)}
      AND ts < {end:DateTime64(3)}
), series AS (
    SELECT ts, value FROM prior
    UNION ALL
    SELECT ts, value FROM windowed
), lagged AS (
    SELECT
        ts,
        value,
        lagInFrame(value, 1, CAST(NULL AS Nullable(Float64))) OVER (ORDER BY ts) AS prev
    FROM series
)
SELECT ts, sum(1) OVER (ORDER BY ts) AS value
FROM lagged
WHERE ts >= {start:DateTime64(3)} AND prev = 0 AND value = 1
ORDER BY ts`;

export default async function clickhouseRises(connection, topic, range, unit) {
    const rows = await connection.query(RISES_SQL, {
        topic,
        start: formatDateTime(range.start),
        end: formatDateTime(range.end)
    });
    return rows.map((row) => {
        return { timestamp: new Date(`${row.ts}Z`), value: row.value, unit };
    });
}

export { RISES_SQL };
