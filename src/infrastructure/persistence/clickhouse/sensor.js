/**
 * Sensor backed by ClickHouse metrics table with downsampling.
 *
 * Reads sensor measurements from scada.metrics table
 * and provides real-time streaming via polling.
 * Supports time-based downsampling using ClickHouse aggregation.
 * Live streams share a connection-level batch hub so many sensors
 * cost one ClickHouse query per tick instead of one query per sensor.
 *
 * @param {object} connection - ClickHouse connection with query method
 * @param {string} topic - Metric topic in format '{machine}/{sensor}'
 * @param {string} displayName - Human-readable sensor name
 * @param {string} unit - Measurement unit (e.g., 'V', 'cos(φ)')
 * @returns {object} sensor with name, current, measurements and stream methods
 *
 * @example
 *   const sensor = clickhouseSensor(conn, 'm1/voltage', 'Voltage', 'V');
 *   sensor.name(); // 'Voltage'
 *   await sensor.current(); // { found: true, timestamp, value, unit } or { found: false }
 *   await sensor.measurements({ start, end }, 60000); // downsampled to 1-minute intervals
 *   sensor.stream(since, 1000, callback); // live stream
 */
import clickhouseStreamHub from './streamHub.js';

function formatDateTime(date) {
    return date.toISOString().replace('Z', '').replace('T', ' ');
}

export default function clickhouseSensor(connection, topic, displayName, unit) {
    return {
        name() {
            return displayName;
        },
        async current() {
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
        },
        async measurements(range, step) {
            const seconds = Math.max(1, Math.floor(step / 1000));
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
                {
                    topic,
                    start: formatDateTime(range.start),
                    end: formatDateTime(range.end)
                }
            );
            return rows.map((row) => {
                return { timestamp: new Date(`${row.ts}Z`), value: row.value, unit };
            });
        },
        stream(since, step, callback, clock) {
            return clickhouseStreamHub(connection).watch(topic, since, step, callback, {
                unit,
                clock
            });
        }
    };
}
