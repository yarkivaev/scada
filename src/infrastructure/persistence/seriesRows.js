function parseTimestamp(ts) {
    return ts instanceof Date ? ts : new Date(ts);
}

/**
 * Maps storage rows onto the sensor measurement shape.
 *
 * @param {Array<{ts: Date|string, value: number}>} rows - storage rows
 * @param {string} unit - measurement unit
 * @returns {Array<{timestamp: Date, value: number, unit: string}>} series
 */
export default function seriesRows(rows, unit) {
    return rows.map((row) => {
        const point = {
            timestamp: parseTimestamp(row.ts),
            value: row.value,
            unit
        };
        if (row.until) {
            point.until = parseTimestamp(row.until);
        }
        return point;
    });
}

export { parseTimestamp };
