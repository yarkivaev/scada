/**
 * Sensor backed by SQLite metrics table with downsampling.
 *
 * Reads sensor measurements from a SQLite metrics table
 * and provides real-time streaming via polling.
 * Supports time-based downsampling using window functions.
 * Timestamps are stored as epoch milliseconds (REAL).
 *
 * @param {object} connection - SQLite connection with query(sql, params) method
 * @param {string} topic - Metric topic in format '{machine}/{sensor}'
 * @param {string} displayName - Human-readable sensor name
 * @param {string} unit - Measurement unit (e.g., 'V', 'cos(φ)')
 * @returns {object} sensor with name, current, measurements and stream methods
 *
 * @example
 *   const sensor = sqliteSensor(conn, 'icht1/voltage', 'Voltage', 'V');
 *   sensor.name(); // 'Voltage'
 *   await sensor.current(); // { found: true, timestamp, value, unit } or { found: false }
 *   await sensor.measurements({ start, end }, 60000); // downsampled to 1-minute intervals
 *   sensor.stream(since, 1000, callback); // live stream
 */
// eslint-disable-next-line max-lines-per-function
export default function sqliteSensor(connection, topic, displayName, unit) {
    return {
        /**
         * Returns the human-readable sensor name.
         *
         * @returns {string} Display name
         */
        name() {
            return displayName;
        },
        /**
         * Returns the most recent measurement.
         *
         * @returns {Promise<object>} Object with found flag and optional timestamp, value, unit
         */
        async current() {
            const rows = await connection.query(
                'SELECT ts, value FROM metrics WHERE topic = ? ORDER BY ts DESC LIMIT 1',
                [topic]
            );
            if (rows.length === 0) {
                return { found: false };
            }
            return { found: true, timestamp: new Date(rows[0].ts), value: rows[0].value, unit };
        },
        /**
         * Returns downsampled measurements within a time range.
         *
         * @param {object} range - Object with start and end Date properties
         * @param {number} step - Downsampling bucket size in milliseconds
         * @returns {Promise<Array>} Array of {timestamp, value, unit} objects
         */
        async measurements(range, step) {
            const millis = Math.max(1000, step);
            const rows = await connection.query(
                `SELECT bucket * ? as ts, value FROM (
                    SELECT CAST(ts / ? AS INTEGER) as bucket, value,
                           ROW_NUMBER() OVER (PARTITION BY CAST(ts / ? AS INTEGER) ORDER BY ts DESC) as rn
                    FROM metrics WHERE topic = ? AND ts >= ? AND ts <= ?
                ) WHERE rn = 1 ORDER BY ts`,
                [millis, millis, millis, topic, range.start.getTime(), range.end.getTime()]
            );
            return rows.map((row) => {
                return { timestamp: new Date(row.ts), value: row.value, unit };
            });
        },
        /**
         * Polls for new measurements and delivers them via callback.
         *
         * @param {Date} since - Start timestamp for polling
         * @param {number} step - Polling interval in milliseconds
         * @param {Function} callback - Called with each {timestamp, value, unit}
         * @param {Function} [clock] - Optional time provider returning current Date
         * @returns {object} Object with cancel() method to stop polling
         */
        stream(since, step, callback, clock) {
            const time = clock || (() => { return new Date(); });
            let lastTs = since;
            const timer = setInterval(async () => {
                try {
                    const rows = await connection.query(
                        'SELECT ts, value FROM metrics WHERE topic = ? AND ts > ? AND ts <= ? ORDER BY ts LIMIT 100',
                        [topic, lastTs.getTime(), time().getTime()]
                    );
                    rows.forEach((row) => {
                        const timestamp = new Date(row.ts);
                        callback({ timestamp, value: row.value, unit });
                        lastTs = timestamp;
                    });
                } catch {
                    // Connection errors are non-fatal; next poll retries
                }
            }, step);
            return {
                /**
                 * Stops the polling timer.
                 */
                cancel() {
                    clearInterval(timer);
                }
            };
        }
    };
}
