/**
 * Reads a downsampled series, rising prefixes, or level changes.
 *
 * @param {object} sensor - machine sensor
 * @param {{start: Date, end: Date}} range - query window
 * @param {number} step - downsample step in ms
 * @param {string} [mode] - rises, changes, or holds
 * @returns {Promise<Array>} series rows
 */
export default function measurementRead(sensor, range, step, mode) {
    if (mode === 'rises') {
        return sensor.rises(range);
    }
    if (mode === 'changes') {
        return sensor.changes(range);
    }
    if (mode === 'holds') {
        return sensor.holds(range, step);
    }
    return sensor.measurements(range, step);
}

/**
 * Packs one sensor series into the measurements JSON item.
 *
 * @param {string} key - sensor key
 * @param {object} sensor - machine sensor
 * @param {Array<{timestamp: Date, value: number, unit: string}>} rows - series
 * @returns {{key: string, name: string, unit: string, values: Array}} item
 */
export function measurementItem(key, sensor, rows) {
    const unit = rows.length > 0 ? rows[0].unit : '';
    const values = rows.map((row) => {
        const point = {
            timestamp: row.timestamp.toISOString(),
            value: row.value
        };
        if (row.until) {
            point.until = row.until.toISOString();
        }
        return point;
    });
    return { key, name: sensor.name(), unit, values };
}
