/**
 * Maps a timeline segment row to REST JSON shape.
 *
 * @param {object} row - segment with start_time, end_time, duration
 * @returns {object} JSON-serializable segment
 *
 * @example
 *   segmentJson({ name: 'on', start_time: new Date(), end_time: new Date(), duration: 60 });
 */
export default function segmentJson(row) {
    const mapped = {
        name: row.name,
        start: row.start_time.toISOString(),
        end: row.duration === 0 ? new Date().toISOString() : row.end_time.toISOString(),
        duration: row.duration
    };
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
