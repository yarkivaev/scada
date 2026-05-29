import machineInPlant from '../../../../application/machineInPlant.js';
import { route, sseResponse, timeExpression } from '@yarkivaev/simple-server';

/**
 * Measurement stream route factory.
 * Creates SSE route for /machines/:machineId/measurements/stream.
 *
 * @param {string} basePath - base URL path
 * @param {object} plant - plant domain object from scada package
 * @param {function} clock - time provider
 * @returns {array} array of route objects
 *
 * @example
 *   const routes = measurementStream('/api/v1', plant, clock);
 */
const RETAIN_MS = 10000;

export default function measurementStream(basePath, plant, clock) {
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
    function subscribe(machine, keys, since, step, sse) {
        const subscriptions = [];
        keys.forEach((key) => {
            if (machine.sensors[key]) {
                const subscription = machine.sensors[key].stream(since, step, (item) => {
                    sse.emit('measurement', {
                        key,
                        timestamp: item.timestamp.toISOString(),
                        value: item.value
                    });
                }, clock);
                subscriptions.push(subscription);
            }
        });
        return subscriptions;
    }
    async function retain(machine, keys, sse) {
        for (const key of keys) {
            if (machine.sensors[key]) {
                // eslint-disable-next-line no-await-in-loop
                const reading = await machine.sensors[key].current();
                if (reading.found && clock().getTime() - reading.timestamp.getTime() < RETAIN_MS) {
                    sse.emit('measurement', {
                        key,
                        timestamp: reading.timestamp.toISOString(),
                        value: reading.value
                    });
                }
            }
        }
    }
    return [
        route(
            'GET',
            `${basePath}/machines/:machineId/measurements/stream`,
            async (req, res, params, query) => {
                const sse = sseResponse(res, clock);
                sse.heartbeat();
                const machine = find(params.machineId);
                if (!machine) {
                    sse.close();
                    return;
                }
                const keys = query.keys ? query.keys.split(',') : Object.keys(machine.sensors);
                const sinceExpr = query.since || 'now';
                const since = timeExpression(sinceExpr, clock, beginning).resolve();
                const step = query.step ? parseInt(query.step, 10) * 1000 : 1000;
                const subscriptions = subscribe(machine, keys, since, step, sse);
                const heartbeat = setInterval(() => {
                    sse.heartbeat();
                }, 30000);
                req.on('close', () => {
                    clearInterval(heartbeat);
                    subscriptions.forEach((subscription) => {
                        subscription.cancel();
                    });
                });
                await retain(machine, keys, sse);
            }
        )
    ];
}
