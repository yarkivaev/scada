import { errorResponse, jsonResponse, route } from '@yarkivaev/simple-server';

/**
 * Simulation control routes factory.
 * Creates routes for jumping, resetting, and querying virtual clock.
 *
 * @param {string} basePath - base URL path
 * @param {function} clock - virtual clock with jump, reset, offset methods
 * @returns {array} array of route objects
 *
 * @example
 *   const routes = simulationRoute('/api', virtualClock(() => new Date()));
 */
export default function simulationRoute(basePath, clock) {
    return [
        route(
            'POST',
            `${basePath}/simulation/jump`,
            (req, res) => {
                let body = '';
                req.on('data', (chunk) => {
                    body += chunk;
                });
                req.on('end', () => {
                    const parsed = JSON.parse(body);
                    const target = new Date(parsed.timestamp);
                    if (isNaN(target.getTime())) {
                        errorResponse('BAD_REQUEST', 'Invalid timestamp', 400).send(res);
                        return;
                    }
                    clock.jump(target);
                    jsonResponse({
                        timestamp: clock().toISOString(),
                        offset: clock.offset()
                    }).send(res);
                });
            }
        ),
        route(
            'DELETE',
            `${basePath}/simulation`,
            (req, res) => {
                clock.reset();
                jsonResponse({
                    timestamp: clock().toISOString(),
                    offset: clock.offset()
                }).send(res);
            }
        ),
        route(
            'GET',
            `${basePath}/simulation`,
            (req, res) => {
                jsonResponse({
                    timestamp: clock().toISOString(),
                    offset: clock.offset()
                }).send(res);
            }
        )
    ];
}
