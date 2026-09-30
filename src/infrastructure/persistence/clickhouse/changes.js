/**
 * Level changes of one ClickHouse metric, including the sample held at the start.
 *
 * Heartbeat repeats of the same value stay in the table and out of the result.
 *
 * @example
 *   await clickhouseChanges(conn, 'm1/flag', { start, end }, '');
 *
 * @param {object} connection - ClickHouse connection with query method
 * @param {string} topic - metric topic
 * @param {{start: Date, end: Date}} range - inclusive window
 * @param {string} unit - measurement unit
 * @returns {Promise<Array<{timestamp: Date, value: number, unit: string}>>} changes
 */
function formatDateTime(date) {
    return date.toISOString().replace('Z', '').replace('T', ' ');
}

const CHANGES_SQL = `WITH prior AS (
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
      AND ts <= {end:DateTime64(3)}
), series AS (
    SELECT ts, value FROM prior
    UNION ALL
    SELECT ts, value FROM windowed
), lagged AS (
    SELECT
        ts,
        value,
        row_number() OVER (ORDER BY ts) AS n,
        lagInFrame(value, 1, NULL) OVER (ORDER BY ts) AS prev
    FROM series
)
SELECT if(ts < {start:DateTime64(3)}, {start:DateTime64(3)}, ts) AS ts, value
FROM lagged
WHERE n = 1 OR value != prev
ORDER BY ts`;

export default async function clickhouseChanges(connection, topic, range, unit) {
    const rows = await connection.query(CHANGES_SQL, {
        topic,
        start: formatDateTime(range.start),
        end: formatDateTime(range.end)
    });
    return rows.map((row) => {
        return { timestamp: new Date(`${row.ts}Z`), value: row.value, unit };
    });
}

export { CHANGES_SQL };
