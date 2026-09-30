import machineInPlant from '../../../../application/machineInPlant.js';
import { jsonResponse, route, timeExpression } from '@yarkivaev/simple-server';
import measurementRead, { measurementItem } from './measurementRead.js';

/**
 * Measurement routes factory.
 * Creates route for GET /machines/:machineId/measurements.
 *
 * @param {string} basePath - base URL path
 * @param {object} plant - plant domain object from scada package
 * @param {function} clock - time provider
 * @returns {array} array of route objects
 *
 * @example
 *   const routes = measurementRoute('/api/v1', plant, clock);
 */
/**
 * Collects measurement items for the requested keys and mode.
 *
 * @param {object} machine - plant machine
 * @param {object} query - HTTP query
 * @param {function} clock - time provider
 * @param {function} beginning - range floor
 * @returns {Promise<Array>} items
 */
async function measure(machine, query, clock, beginning) {
    const requested = query.keys ? query.keys.split(',') : Object.keys(machine.sensors);
    const keys = requested.filter((key) => {
        return machine.sensors[key];
    });
    const from = timeExpression(query.from || 'now-1M', clock, beginning).resolve();
    const to = timeExpression(query.to || 'now', clock, beginning).resolve();
    const step = query.step ? parseInt(query.step, 10) * 1000 : 1000;
    const range = { start: from, end: to };
    return await Promise.all(keys.map(async (key) => {
        const sensor = machine.sensors[key];
        const rows = await measurementRead(sensor, range, step, query.mode);
        return measurementItem(key, sensor, rows);
    }));
}

export default function measurementRoute(basePath, plant, clock) {
    function beginning() {
        return new Date(clock().getTime() - 30 * 24 * 60 * 60 * 1000);
    }
    function find(id) {
        const result = machineInPlant(plant, id);
        if (result) {
            return result.machine;
        }
        return undefined;
    }
    return [
        route(
            'GET',
            `${basePath}/machines/:machineId/measurements`,
            async (req, res, params, query) => {
                const machine = find(params.machineId);
                if (!machine) {
                    jsonResponse({ items: [] }).send(res);
                    return;
                }
                const items = await measure(machine, query, clock, beginning);
                jsonResponse({ items }).send(res);
            }
        )
    ];
}
