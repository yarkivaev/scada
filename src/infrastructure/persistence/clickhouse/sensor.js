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
 * @returns {object} sensor with name, current, measurements, rises, changes and stream methods
 *
 * @example
 *   const sensor = clickhouseSensor(conn, 'm1/voltage', 'Voltage', 'V');
 *   sensor.name(); // 'Voltage'
 *   await sensor.current(); // { found: true, timestamp, value, unit } or { found: false }
 *   await sensor.measurements({ start, end }, 60000); // downsampled to 1-minute intervals
 *   sensor.stream(since, 1000, callback); // live stream
 */
import clickhouseStreamHub from './streamHub.js';
import clickhouseRises from './rises.js';
import clickhouseChanges from './changes.js';
import clickhouseHolds from './holds.js';
import clickhouseSeries from './series.js';
import clickhouseLatest from './latest.js';

export default function clickhouseSensor(connection, topic, displayName, unit) {
    return {
        name() {
            return displayName;
        },
        current() {
            return clickhouseLatest(connection, topic, unit);
        },
        measurements(range, step) {
            return clickhouseSeries(connection, topic, range, step, unit);
        },
        rises(range) {
            return clickhouseRises(connection, topic, range, unit);
        },
        changes(range) {
            return clickhouseChanges(connection, topic, range, unit);
        },
        holds(range, step) {
            return clickhouseHolds(connection, topic, range, step, unit);
        },
        stream(since, step, callback, clock) {
            return clickhouseStreamHub(connection).watch(topic, since, step, callback, {
                unit,
                clock
            });
        }
    };
}
