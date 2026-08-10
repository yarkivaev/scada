/**
 * Batched ClickHouse poll for many topic cursors.
 *
 * Issues a single IN-query for all topics so stream CPU stays proportional
 * to poll pulses, not to the number of subscribed sensors.
 *
 * @param {object} connection - ClickHouse connection with query(sql, params)
 * @param {Array<{topic: string, since: Date}>} cursors - per-topic watermarks
 * @param {Date} until - exclusive upper bound
 * @returns {Promise<Array<{topic: string, ts: string, value: number}>>} rows
 *
 * @example
 *   const rows = await pollTopicCursors(conn, [
 *     { topic: 'm1/voltage', since: lastTs }
 *   ], new Date());
 */
function formatDateTime(date) {
    return date.toISOString().replace('Z', '').replace('T', ' ');
}

export default function pollTopicCursors(connection, cursors, until) {
    if (cursors.length === 0) {
        return Promise.resolve([]);
    }
    const topics = cursors.map((cursor) => {
        return cursor.topic;
    });
    let oldest = cursors[0].since;
    cursors.forEach((cursor) => {
        if (cursor.since.getTime() < oldest.getTime()) {
            oldest = cursor.since;
        }
    });
    return connection.query(
        `SELECT topic, ts, value FROM scada.metrics
         WHERE topic IN {topics:Array(String)}
           AND ts > {since:DateTime64(3)}
           AND ts <= {until:DateTime64(3)}
         ORDER BY topic, ts
         LIMIT {limit:UInt32}`,
        {
            topics,
            since: formatDateTime(oldest),
            until: formatDateTime(until),
            limit: Math.max(100, topics.length * 100)
        }
    );
}
