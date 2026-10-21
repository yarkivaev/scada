/**
 * Caps a row list at the analytics response limit.
 *
 * @param {Array} rows - port rows
 * @returns {{rows: Array, truncated: boolean}} capped rows
 *
 * @example
 *   capRows([{ id: 1 }]);
 */
export function capRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    return {
        rows: list.slice(0, 200),
        truncated: list.length > 200
    };
}

/**
 * Wraps a payload as MCP text content.
 *
 * @param {object} payload - JSON payload
 * @returns {object} tool result
 *
 * @example
 *   toolText({ rows: [] });
 */
export function toolText(payload) {
    return {
        content: [{
            text: JSON.stringify(payload),
            type: 'text'
        }]
    };
}

/**
 * Reads a point list from an array or a points field.
 *
 * @param {Array|object} raw - port payload
 * @returns {Array} points
 *
 * @example
 *   readPoints({ points: [1] });
 */
function readPoints(raw) {
    if (Array.isArray(raw)) {
        return raw;
    }
    if (raw && Array.isArray(raw.points)) {
        return raw.points;
    }
    return [];
}

/**
 * Reads the step the port actually used.
 *
 * @param {Array|object} raw - port payload
 * @param {number} step - requested step seconds
 * @returns {number} step seconds
 *
 * @example
 *   readStep({ points: [], step: 30 }, 15);
 */
function readStep(raw, step) {
    if (raw && typeof raw.step === 'number') {
        return raw.step;
    }
    return step;
}

/**
 * Keeps a truncated flag supplied by the port.
 *
 * @param {Array|object} raw - port payload
 * @returns {boolean} whether the port already truncated
 *
 * @example
 *   flagged({ truncated: true });
 */
function flagged(raw) {
    if (raw && raw.truncated === true) {
        return true;
    }
    return false;
}

/**
 * Caps measurement points at 200 and reports the step.
 *
 * @param {Array|object} raw - port payload
 * @param {number} step - requested step seconds
 * @returns {object} points, step, truncated
 *
 * @example
 *   capMeasurements([{ v: 1 }], 15);
 */
export function capMeasurements(raw, step) {
    const points = readPoints(raw);
    const truncated = points.length > 200 || flagged(raw);
    return {
        points: points.slice(0, 200),
        step: readStep(raw, step),
        truncated
    };
}
