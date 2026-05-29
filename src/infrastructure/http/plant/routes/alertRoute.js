import { errorResponse, jsonResponse, pagination, route } from '@yarkivaev/simple-server';

/**
 * Alert routes factory.
 * Creates routes for GET and PATCH /machines/:machineId/alerts.
 *
 * @param {string} basePath - base URL path
 * @param {object} plant - plant domain object from scada package
 * @returns {array} array of route objects
 *
 * @example
 *   const routes = alertRoute('/api/v1', plant);
 */
export default function alertRoute(basePath, plant) {
    function find(id) {
        for (const shop of Object.values(plant.shops.get())) {
            const machine = shop.machines.get()[id];
            if (machine) {
                return machine;
            }
        }
        return undefined;
    }
    function findAlert(alertId) {
        for (const shop of Object.values(plant.shops.get())) {
            for (const machine of Object.values(shop.machines.get())) {
                const alert = machine.alerts().find((a) => {
                    return a.id === alertId;
                });
                if (alert) {
                    return alert;
                }
            }
        }
        return undefined;
    }
    return [
        route(
            'GET',
            `${basePath}/machines/:machineId/alerts`,
            (req, res, params, query) => {
                const machine = find(params.machineId);
                if (!machine) {
                    jsonResponse({ items: [], page: 1, size: 10, total: 0 }).send(res);
                    return;
                }
                const page = query.page ? parseInt(query.page, 10) : 1;
                const size = query.size ? parseInt(query.size, 10) : 10;
                let alerts = machine.alerts();
                if (query.acknowledged === 'true') {
                    alerts = alerts.filter((a) => {
                        return a.acknowledged === true;
                    });
                } else if (query.acknowledged === 'false') {
                    alerts = alerts.filter((a) => {
                        return a.acknowledged === false;
                    });
                }
                const mapped = alerts.map((a) => {
                    return { id: a.id, message: a.message, timestamp: a.timestamp.toISOString(), object: a.object, acknowledged: a.acknowledged, name: a.name };
                });
                const paginated = pagination(page, size, mapped).result();
                jsonResponse({ items: paginated.items, page: paginated.page, size: paginated.size, total: paginated.total }).send(res);
            }
        ),
        route(
            'PATCH',
            `${basePath}/machines/:machineId/alerts/:alertId`,
            (req, res, params) => {
                let body = '';
                req.on('data', (chunk) => {
                    body += chunk;
                });
                req.on('end', () => {
                    const changes = JSON.parse(body);
                    const alert = findAlert(params.alertId);
                    if (!alert) {
                        errorResponse(
                            'NOT_FOUND',
                            `Alert '${params.alertId}' not found`,
                            404
                        ).send(res);
                        return;
                    }
                    if (changes.acknowledged === true && !alert.acknowledged) {
                        alert.acknowledge();
                    }
                    jsonResponse({ id: alert.id, message: alert.message, timestamp: alert.timestamp.toISOString(), object: alert.object, acknowledged: true, name: alert.name }).send(res);
                });
            }
        )
    ];
}
