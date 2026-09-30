/**
 * Latest sample of one ClickHouse metric topic.
 *
 * @param {object} connection - ClickHouse connection with query method
 * @param {string} topic - metric topic
 * @param {string} unit - measurement unit
 * @returns {Promise<{found: boolean, timestamp?: Date, value?: number, unit?: string}>} reading
 */
export default async function clickhouseLatest(connection, topic, unit) {
    const rows = await connection.query(
        `SELECT ts, value FROM scada.metrics
         WHERE topic = {topic:String}
         ORDER BY ts DESC LIMIT 1`,
        { topic }
    );
    if (rows.length === 0) {
        return { found: false };
    }
    return { found: true, timestamp: new Date(`${rows[0].ts}Z`), value: rows[0].value, unit };
}
