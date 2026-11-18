/**
 * Maps a timeline segment row to REST JSON shape.
 *
 * @param {object} row - segment with start_time, end_time, duration
 * @param {function} [clock] - paints duration-zero end as now when provided
 * @returns {object} JSON-serializable segment
 *
 * @example
 *   segmentJson({ name: 'on', start_time: new Date(), end_time: new Date(), duration: 60 });
 */
export default function segmentJson(row, clock) {
    const live = row.duration === 0 && typeof clock === 'function';
    const mapped = {
        name: row.name,
        start: row.start_time.toISOString(),
        end: live ? clock().toISOString() : row.end_time.toISOString(),
        duration: row.duration
    };
    if (row.kind) {
        mapped.kind = row.kind;
    }
    if (row.options) {
        mapped.options = row.options;
    }
    if (row.tags) {
        mapped.tags = row.tags;
    }
    if (row.properties) {
        mapped.properties = row.properties;
    }
    return mapped;
}

/**
 * Maps GET /segments rows so only the last duration-zero end is painted as now.
 *
 * @param {object[]} rows - timeline rows
 * @param {function} [clock] - now source for the live pending row
 * @returns {object[]} JSON-serializable segments
 *
 * @example
 *   segmentItems(rows);
 */
export function segmentItems(rows, clock = () => {
    return new Date();
}) {
    const last = rows.reduce((index, row, i) => {
        return row.duration === 0 ? i : index;
    }, -1);
    return rows.map((row, i) => {
        if (i === last) {
            return segmentJson(row, clock);
        }
        if (row.duration !== 0) {
            return segmentJson(row);
        }
        const elapsed = Math.max(1, (Date.parse(row.end_time) - Date.parse(row.start_time)) / 1000);
        return segmentJson({ ...row, duration: elapsed });
    });
}
