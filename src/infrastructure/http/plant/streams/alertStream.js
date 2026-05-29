import { route, sseResponse } from '@yarkivaev/simple-server';

/**
 * Alert stream route factory.
 * Creates SSE route for /machines/:machineId/alerts/stream.
 * Streams alert_created and alert_updated events for the specified machine.
 *
 * @param {string} basePath - base URL path
 * @param {object} plant - plant domain object from scada package
 * @param {function} clock - time provider
 * @returns {array} array of route objects
 *
 * @example
 *   const routes = alertStream('/api/v1', plant, clock);
 */
export default function alertStream(basePath, plant, clock) {
    function find(machineId) {
        for (const shop of Object.values(plant.shops.get())) {
            const machine = shop.machines.get()[machineId];
            if (machine) {
                return { machine, shop };
            }
        }
        return undefined;
    }
    return [
        route(
            'GET',
            `${basePath}/machines/:machineId/alerts/stream`,
            (req, res, params) => {
                const sse = sseResponse(res, clock);
                sse.heartbeat();
                const result = find(params.machineId);
                if (!result) {
                    sse.close();
                    return;
                }
                const { machine, shop } = result;
                const subscription = shop.alerts.stream((event) => {
                    if (event.alert.object === machine.name()) {
                        if (event.type === 'created') {
                            sse.emit('alert_created', {
                                id: event.alert.id,
                                message: event.alert.message,
                                timestamp: event.alert.timestamp.toISOString(),
                                object: event.alert.object,
                                acknowledged: event.alert.acknowledged,
                                name: event.alert.name
                            });
                        } else if (event.type === 'acknowledged') {
                            sse.emit('alert_updated', {
                                id: event.alert.id,
                                acknowledged: true
                            });
                        }
                    }
                });
                const heartbeat = setInterval(() => {
                    sse.heartbeat();
                }, 30000);
                req.on('close', () => {
                    clearInterval(heartbeat);
                    subscription.cancel();
                });
            }
        )
    ];
}
