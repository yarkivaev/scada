/**
 * Sensor backed by ScyllaDB metrics table.
 *
 * Reads sensor measurements from scada.metrics table
 * and provides real-time streaming via polling.
 *
 * @param {object} connection - ScyllaDB connection with query method
 * @param {string} topic - Metric topic in format '{machine}/{sensor}'
 * @param {string} displayName - Human-readable sensor name
 * @param {string} unit - Measurement unit (e.g., 'V', 'cos(φ)')
 * @returns {object} sensor with name, measurements and stream methods
 *
 * @example
 *   const sensor = scyllaSensor(conn, 'icht1/voltage', 'Напряжение', 'V');
 *   sensor.name(); // 'Напряжение'
 *   await sensor.measurements({ start, end }); // array of readings
 *   sensor.stream(since, 1000, callback); // live stream
 */
export default function scyllaSensor(connection, topic, displayName, unit) {
    return {
        name() {
            return displayName;
        },
        async measurements(range) {
            const rows = await connection.query(
                'SELECT ts, value FROM scada.metrics WHERE topic = ? AND ts >= ? AND ts <= ?',
                [topic, range.start, range.end]
            );
            return rows.map((row) => {
                return { timestamp: row.ts, value: row.value, unit };
            });
        },
        stream(since, step, callback) {
            let lastTs = since;
            const timer = setInterval(async () => {
                const rows = await connection.query(
                    'SELECT ts, value FROM scada.metrics WHERE topic = ? AND ts > ? LIMIT 100',
                    [topic, lastTs]
                );
                rows.forEach((row) => {
                    callback({ timestamp: row.ts, value: row.value, unit });
                    lastTs = row.ts;
                });
            }, step);
            return {
                cancel() {
                    clearInterval(timer);
                }
            };
        }
    };
}
