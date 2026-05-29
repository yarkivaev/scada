import machineInPlant from '../../../../application/machineInPlant.js';
import { jsonResponse, route, timeExpression } from '@yarkivaev/simple-server';

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
                const requested = query.keys ? query.keys.split(',') : Object.keys(machine.sensors);
                const keys = requested.filter((key) => {return machine.sensors[key]});
                const fromExpr = query.from || 'now-1M';
                const toExpr = query.to || 'now';
                const from = timeExpression(fromExpr, clock, beginning).resolve();
                const to = timeExpression(toExpr, clock, beginning).resolve();
                const step = query.step ? parseInt(query.step, 10) * 1000 : 1000;
                const range = { start: from, end: to };
                const promises = keys.map(async (key) => {
                    const sensor = machine.sensors[key];
                    const measurements = await sensor.measurements(range, step);
                    const unit = measurements.length > 0 ? measurements[0].unit : '';
                    const values = measurements.map((row) => {return {
                        timestamp: row.timestamp.toISOString(),
                        value: row.value
                    }});
                    return { key, name: sensor.name(), unit, values };
                });
                const items = await Promise.all(promises);
                jsonResponse({ items }).send(res);
            }
        )
    ];
}
