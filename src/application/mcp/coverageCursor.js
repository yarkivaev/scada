const EMPTY = '1970-01-01T00:00:00.000Z';

/**
 * Reads epoch milliseconds from a cursor value.
 *
 * @param {Date|number|string|object} value - instant or { at }
 * @returns {number} epoch milliseconds, or NaN
 *
 * @example
 *   instant({ at: '2024-11-02T03:04:05.137Z' });
 */
function instant(value) {
    if (value && typeof value === 'object' && !(value instanceof Date) && Object.hasOwn(value, 'at')) {
        return instant(value.at);
    }
    if (value instanceof Date) {
        return value.getTime();
    }
    if (typeof value === 'number') {
        return value;
    }
    if (value === undefined || value === null || value === '') {
        return Number.NaN;
    }
    return Date.parse(String(value));
}

/**
 * Formats a covered instant, treating epoch and gaps as empty.
 *
 * @param {Date|number|string|object} value - instant
 * @returns {string} ISO instant, or the empty cursor
 *
 * @example
 *   covered('2024-11-02T03:04:05.137Z');
 */
function covered(value) {
    const at = instant(value);
    if (!Number.isFinite(at) || at <= 0) {
        return EMPTY;
    }
    return new Date(at).toISOString();
}

/**
 * Latest sample instant, or the empty cursor when none exist.
 *
 * @param {Array} samples - instants or objects with ts
 * @returns {string} ISO instant
 *
 * @example
 *   latest([{ ts: '2024-11-02T03:04:05.137Z' }]);
 */
function latest(samples) {
    const rows = Array.isArray(samples) ? samples : [];
    let mark = 0;
    for (const sample of rows) {
        const raw = sample && typeof sample === 'object' && Object.hasOwn(sample, 'ts')
            ? sample.ts
            : sample;
        const at = instant(raw);
        if (Number.isFinite(at) && at > mark) {
            mark = at;
        }
    }
    return mark > 0 ? new Date(mark).toISOString() : EMPTY;
}

/**
 * Reads the newest ingest checkpoint for a machine.
 *
 * @param {object|undefined} pool - pg pool
 * @param {string} machine - machine id
 * @returns {Promise<string>} ISO instant, or the empty cursor
 *
 * @example
 *   checkpoint(pool, 'machine1');
 */
async function checkpoint(pool, machine) {
    if (!pool) {
        return EMPTY;
    }
    const result = await pool.query(
        'SELECT cursor_at FROM ingest_checkpoints WHERE machine = $1 ORDER BY cursor_at DESC LIMIT 1',
        [machine]
    );
    if (result.rows.length === 0) {
        return EMPTY;
    }
    return covered(result.rows[0].cursor_at);
}

/**
 * Coverage cursor: ingest checkpoint, else latest metric instant.
 *
 * Central ingest does not write ingest_checkpoints. When that table is empty,
 * the latest sample is the covered bound so coverageSpans can paint present
 * and absent instead of the whole window unknown.
 *
 * @param {object|undefined} pool - pg pool
 * @param {Function} samples - async (args) => sample list
 * @returns {Function} cursor port ({ machine, path }) => ISO instant
 *
 * @example
 *   coverageCursor(pool, ({ path }) => ports.samples({ path }))({ machine: 'm1' });
 */
export default function coverageCursor(pool, samples) {
    return async function bound(args) {
        const machine = args.machine || args.path;
        const mark = await checkpoint(pool, machine);
        if (instant(mark) > 0) {
            return mark;
        }
        return latest(await samples(args));
    };
}
