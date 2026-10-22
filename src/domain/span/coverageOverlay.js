/**
 * Reads epoch milliseconds from a number, Date, or parseable string.
 *
 * @param {Date|number|string} value - instant
 * @returns {number} epoch milliseconds, or NaN
 *
 * @example
 *   epoch('2024-11-02T03:04:05.137Z');
 */
function epoch(value) {
    if (typeof value === 'number') {
        return value;
    }
    if (value instanceof Date) {
        return value.getTime();
    }
    return Date.parse(String(value));
}

/**
 * Converts an instant and rejects values that are not a time.
 *
 * @param {Date|number|string} value - instant
 * @returns {number} epoch milliseconds
 *
 * @example
 *   stamp('2024-11-02T03:04:05.137Z');
 */
function stamp(value) {
    const at = epoch(value);
    if (Number.isNaN(at)) {
        throw new Error(`Coverage overlay instant is not a time: ${value}`);
    }
    return at;
}

/**
 * Reads a segment bound from one of the accepted field names.
 *
 * @param {object} row - segment
 * @param {Array<string>} names - field names
 * @returns {Date|number|string} instant
 *
 * @example
 *   field({ start_time: '2024-11-02T03:04:05.137Z' }, ['start_time', 'from']);
 */
function field(row, names) {
    const name = names.find((key) => {
        return Object.hasOwn(row, key);
    });
    if (!name) {
        throw new Error(`Coverage overlay bound is missing: ${names.join(',')}`);
    }
    return row[name];
}

/**
 * Normalizes a timeline row to epoch bounds and a name.
 *
 * @param {object} row - segment
 * @returns {{from: number, name: string, to: number}} interval
 *
 * @example
 *   bounds({ name: 'off', start_time: 0, end_time: 1 });
 */
function bounds(row) {
    return {
        from: stamp(field(row, ['start_time', 'from', 'start'])),
        name: typeof row.name === 'string' ? row.name : '',
        to: stamp(field(row, ['end_time', 'to', 'end']))
    };
}

/**
 * Unique sorted cut points of a span and the intervals that cross it.
 *
 * @param {object} span - coverage span
 * @param {Array<object>} rows - normalized intervals
 * @returns {Array<number>} epochs
 *
 * @example
 *   cuts({ from: 'a', to: 'b' }, []);
 */
function cuts(span, rows) {
    const start = stamp(span.from);
    const stop = stamp(span.to);
    const marks = [start, stop];
    rows.forEach((row) => {
        if (row.from > start && row.from < stop) {
            marks.push(row.from);
        }
        if (row.to > start && row.to < stop) {
            marks.push(row.to);
        }
    });
    return Array.from(new Set(marks)).sort((left, right) => {
        return left - right;
    });
}

/**
 * Timeline name that overlaps an open interval, or an empty string.
 *
 * @param {Array<object>} rows - normalized intervals
 * @param {number} from - start epoch
 * @param {number} to - end epoch
 * @returns {string} name
 *
 * @example
 *   title([{ from: 0, name: 'off', to: 10 }], 0, 10);
 */
function title(rows, from, to) {
    const hit = rows.find((row) => {
        return row.from < to && row.to > from;
    });
    if (!hit) {
        return '';
    }
    return hit.name;
}

/**
 * Splits one coverage span on overlapping timeline names.
 *
 * @param {object} span - coverage span
 * @param {Array<object>} rows - normalized intervals
 * @returns {Array<object>} painted spans
 *
 * @example
 *   paint({ from: 'a', status: 'present', to: 'b' }, []);
 */
function paint(span, rows) {
    const marks = cuts(span, rows);
    return marks.slice(0, -1).map((from, index) => {
        const to = marks[index + 1];
        return {
            from: new Date(from).toISOString(),
            phase: title(rows, from, to),
            status: span.status,
            to: new Date(to).toISOString()
        };
    });
}

/**
 * Paints overlapping timeline names onto coverage spans.
 *
 * coverageSpans stays a status classifier. This join splits a span wherever
 * a timeline interval starts or ends and copies that interval name as phase.
 *
 * @param {Array<object>} spans - coverage spans
 * @param {Array<object>} segments - timeline rows
 * @returns {Array<object>} spans with phase
 *
 * @example
 *   coverageOverlay([{ from, status: 'present', to }], [{ name, start_time, end_time }]);
 */
export default function coverageOverlay(spans, segments) {
    const rows = (Array.isArray(segments) ? segments : []).map(bounds);
    const list = Array.isArray(spans) ? spans : [];
    return list.flatMap((span) => {
        return paint(span, rows);
    });
}
