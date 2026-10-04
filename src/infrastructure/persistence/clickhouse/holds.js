/**
 * Coverage holds of one ClickHouse metric.
 *
 * Heartbeat repeats stay in one span. A value change or a silence
 * longer than gap closes the span. Samples before the window are ignored.
 *
 * @example
 *   await clickhouseHolds(conn, 'm1/diam', { start, end }, 3000, 'mm');
 *
 * @param {object} connection - ClickHouse connection with query method
 * @param {string} topic - metric topic
 * @param {{start: Date, end: Date}} range - half-open window
 * @param {number} gap - maximum silence in milliseconds
 * @param {string} unit - measurement unit
 * @returns {Promise<Array<{timestamp: Date, value: number, until: Date, unit: string}>>} holds
 */
function formatDateTime(date) {
    return date.toISOString().replace('Z', '').replace('T', ' ');
}

const HOLDS_SQL = `WITH windowed AS (
    SELECT ts, value
    FROM scada.metrics
    WHERE topic = {topic:String}
      AND ts >= {start:DateTime64(3)}
      AND ts < {end:DateTime64(3)}
), lagged AS (
    SELECT
        ts,
        value,
        lagInFrame(ts, 1) OVER (ORDER BY ts) AS prev_ts,
        lagInFrame(toNullable(value), 1) OVER (ORDER BY ts) AS prev
    FROM windowed
), flagged AS (
    SELECT
        ts,
        value,
        if(
            prev IS NULL
                OR value != prev
                OR toUnixTimestamp64Milli(ts) - toUnixTimestamp64Milli(prev_ts) > {gap:UInt64},
            1,
            0
        ) AS fresh
    FROM lagged
), grouped AS (
    SELECT
        ts,
        value,
        sum(fresh) OVER (ORDER BY ts) AS grp
    FROM flagged
)
SELECT min(ts) AS ts, max(ts) AS until, any(value) AS value
FROM grouped
GROUP BY grp
ORDER BY ts`;

export default async function clickhouseHolds(connection, topic, range, gap, unit) {
    const rows = await connection.query(HOLDS_SQL, {
        topic,
        start: formatDateTime(range.start),
        end: formatDateTime(range.end),
        gap: Math.max(1, Number(gap) || 1000)
    });
    return rows.map((row) => {
        return {
            timestamp: new Date(`${row.ts}Z`),
            value: row.value,
            until: new Date(`${row.until}Z`),
            unit
        };
    });
}

export { HOLDS_SQL };
