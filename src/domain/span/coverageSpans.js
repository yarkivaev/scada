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
        throw new Error(`Coverage instant is not a time: ${value}`);
    }
    return at;
}

/**
 * Reads a sample instant from a raw value or a ts field.
 *
 * @param {Date|number|string|object} sample - sample
 * @returns {Date|number|string} instant
 *
 * @example
 *   readSample({ ts: '2024-11-02T03:04:05.137Z' });
 */
function readSample(sample) {
    if (sample && typeof sample === 'object' && Object.hasOwn(sample, 'ts')) {
        return sample.ts;
    }
    return sample;
}

/**
 * Keeps samples inside the cursor-covered part of the window, in order.
 *
 * @param {Array} samples - raw samples
 * @param {number} start - window start epoch
 * @param {number} stop - covered end epoch
 * @returns {Array<number>} sorted epochs
 *
 * @example
 *   clip(['2024-11-02T03:04:05.137Z'], 0, 1);
 */
function clip(samples, start, stop) {
    const picked = [];
    for (const sample of samples) {
        const at = stamp(readSample(sample));
        if (at >= start && at <= stop) {
            picked.push(at);
        }
    }
    picked.sort((left, right) => {
        return left - right;
    });
    return picked;
}

/**
 * Builds one span per consecutive bound.
 *
 * @param {number} start - covered start
 * @param {number} stop - covered end
 * @param {Array<number>} points - sample epochs
 * @param {number} silence - silence milliseconds
 * @returns {Array<object>} unmerged spans
 *
 * @example
 *   gaps(0, 10, [0, 10], 30);
 */
function gaps(start, stop, points, silence) {
    const bounds = [start, ...points, stop];
    const spans = [];
    for (let index = 0; index < bounds.length - 1; index += 1) {
        const left = bounds[index];
        const right = bounds[index + 1];
        const status = right - left > silence ? 'absent' : 'present';
        spans.push({ from: left, status, to: right });
    }
    return spans;
}

/**
 * Drops empty spans and joins neighbors that share a status.
 *
 * @param {Array<object>} spans - raw spans
 * @returns {Array<object>} merged spans
 *
 * @example
 *   merge([{ from: 0, status: 'present', to: 10 }]);
 */
function merge(spans) {
    const open = spans.filter((span) => {
        return span.to > span.from;
    });
    const kept = [];
    for (const span of open) {
        const last = kept[kept.length - 1];
        if (last && last.status === span.status && last.to === span.from) {
            kept[kept.length - 1] = { from: last.from, status: last.status, to: span.to };
        } else {
            kept.push({ from: span.from, status: span.status, to: span.to });
        }
    }
    return kept;
}

/**
 * Classifies the cursor-covered interval.
 *
 * @param {number} start - window start
 * @param {number} stop - covered end
 * @param {Array<number>} points - samples inside the covered interval
 * @param {number} silence - silence milliseconds
 * @returns {Array<object>} present and absent spans
 *
 * @example
 *   paint(0, 10, [], 30);
 */
function paint(start, stop, points, silence) {
    if (stop <= start) {
        return [];
    }
    if (points.length === 0) {
        return [{ from: start, status: 'absent', to: stop }];
    }
    return merge(gaps(start, stop, points, silence));
}

/**
 * Renders spans as ISO-8601 instants.
 *
 * @param {Array<object>} spans - epoch spans
 * @returns {Array<object>} ISO spans
 *
 * @example
 *   iso([{ from: 0, status: 'unknown', to: 1 }]);
 */
function iso(spans) {
    return spans.map((span) => {
        return {
            from: new Date(span.from).toISOString(),
            status: span.status,
            to: new Date(span.to).toISOString()
        };
    });
}

/**
 * Requires a non-negative silence gap.
 *
 * @param {number} silenceMs - silence milliseconds
 * @returns {number} silence milliseconds
 *
 * @example
 *   silenceOf(60000);
 */
function silenceOf(silenceMs) {
    if (typeof silenceMs === 'number' && silenceMs >= 0) {
        return silenceMs;
    }
    throw new Error(`Coverage silence is missing: ${silenceMs}`);
}

/**
 * Requires an array of samples.
 *
 * @param {Array} samples - raw samples
 * @returns {Array} samples
 *
 * @example
 *   samplesOf([]);
 */
function samplesOf(samples) {
    if (Array.isArray(samples)) {
        return samples;
    }
    throw new Error('Coverage samples are missing');
}

/**
 * Classifies a metric window as present, absent, or unknown.
 *
 * Present means consecutive samples stay within the silence gap. Absent means
 * a hole is longer than that gap and the ingest cursor has already passed it.
 * Unknown is the part of the window after the cursor. An empty window that the
 * cursor already covered is absent.
 *
 * @param {Array} samples - instants, or objects with ts
 * @param {Date|number|string} from - window start
 * @param {Date|number|string} to - window end
 * @param {number} silenceMs - maximum present gap in milliseconds
 * @param {Date|number|string} cursor - latest ingested instant
 * @returns {Array<{from: string, to: string, status: string}>} ISO spans
 *
 * @example
 *   coverageSpans(['2024-11-02T03:04:05.137Z'], '2024-11-02T03:04:05.137Z',
 *     '2024-11-02T03:05:05.137Z', 60000, '2024-11-02T03:05:05.137Z');
 */
export default function coverageSpans(samples, from, to, silenceMs, cursor) {
    const end = stamp(to);
    const mark = stamp(cursor);
    const silence = silenceOf(silenceMs);
    const start = stamp(from);
    const stop = mark < end ? Math.max(mark, start) : end;
    const points = clip(samplesOf(samples), start, stop);
    const known = paint(start, stop, points, silence);
    const tail = stop < end ? [{ from: stop, status: 'unknown', to: end }] : [];
    return iso(merge(known.concat(tail)));
}
