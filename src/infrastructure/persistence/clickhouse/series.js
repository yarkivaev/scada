/**
 * Downsampled ClickHouse metric series for one topic.
 *
 * @param {object} connection - ClickHouse connection with query method
 * @param {string} topic - metric topic
 * @param {{start: Date, end: Date}} range - inclusive window
 * @param {number} step - downsample step in ms
 * @param {string} unit - measurement unit
 * @returns {Promise<Array<{timestamp: Date, value: number, unit: string}>>} buckets
 */
export default async function clickhouseSeries(connection, topic, range, step, unit) {
    const seconds = Math.max(1, Math.floor(step / 1000));
    const start = range.start.toISOString().replace('Z', '').replace('T', ' ');
    const end = range.end.toISOString().replace('Z', '').replace('T', ' ');
    const rows = await connection.query(
        `SELECT
            toStartOfInterval(ts, INTERVAL ${seconds} SECOND) as ts,
            anyLast(value) as value
        FROM scada.metrics
        WHERE topic = {topic:String}
          AND ts >= toStartOfInterval({start:DateTime64(3)}, INTERVAL ${seconds} SECOND)
          AND ts <= {end:DateTime64(3)}
        GROUP BY ts
        ORDER BY ts`,
        { topic, start, end }
    );
    return rows.map((row) => {
        return { timestamp: new Date(`${row.ts}Z`), value: row.value, unit };
    });
}
