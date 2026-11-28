import locate from './locateMachineMetric.js';

/**
 * Reads a sensor series for one measurement mode.
 *
 * @param {object} sensor - plant sensor
 * @param {object} args - from, to, step, mode
 * @returns {Promise<Array>} series rows
 *
 * @example
 *   seriesOf(sensor, { from, to, step: 60 });
 */
function seriesOf(sensor, args) {
    const range = { end: new Date(args.to), start: new Date(args.from) };
    const step = args.step * 1000;
    if (args.mode === 'samples') {
        if (typeof sensor.samples !== 'function') {
            throw Object.assign(new Error('Historical raw density is unavailable: this sensor does not support raw samples'), { code: 'SCADA_HISTORY_DENSITY_UNAVAILABLE', status: 409, statusCode: 409 });
        }
        return sensor.samples(range);
    }
    if (args.mode === 'rises') {
        return sensor.rises(range);
    }
    if (args.mode === 'changes') {
        return sensor.changes(range);
    }
    if (args.mode === 'holds') {
        return sensor.holds(range, step);
    }
    return sensor.measurements(range, step);
}

/**
 * Maps a sensor row to a coverage or measurement point.
 *
 * @param {object} row - sensor sample
 * @returns {object} point with ts
 *
 * @example
 *   pointOf({ timestamp: new Date(), value: 1 });
 */
function pointOf(row) {
    const stamp = row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp;
    const point = { ts: stamp, value: row.value };
    if (typeof row.continuous === 'boolean') { point.continuous = row.continuous; }
    return point;
}

/**
 * Loads points for one namespace path.
 *
 * @param {object} plant - plant hierarchy
 * @param {string} path - namespace path
 * @param {object} args - from, to, step, mode
 * @returns {Promise<Array>} points
 *
 * @example
 *   loadSeries(plant, 'site/unit/power', args);
 */
export default async function loadSeries(plant, path, args) {
    const found = locate(plant, path);
    const sensor = found.metric ? found.machine.sensors[found.metric] : undefined;
    if (!sensor) {
        return [];
    }
    const rows = await seriesOf(sensor, args);
    return rows.map(pointOf);
}
