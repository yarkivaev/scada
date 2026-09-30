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
        return {
            timestamp: parseTimestamp(row.ts),
            value: row.value,
            unit
        };
    });
}

export { parseTimestamp };
