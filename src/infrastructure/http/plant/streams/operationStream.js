import operationJson from '../json/operationJson.js';
import { route, sseResponse } from '@yarkivaev/simple-server';

/**
 * Operations SSE route for plant-wide create, update, and delete events.
 *
 * @param {string} basePath - base URL path
 * @param {object} plant - plant domain object
 * @param {function} clock - time provider
 * @returns {array} route objects
 *
 * @example
 *   operationStream('/api/v1', plant, clock);
 */
export default function operationStream(basePath, plant, clock) {
    return [
        route('GET', `${basePath}/operations/stream`, (req, res) => {
            const sse = sseResponse(res, clock);
            sse.heartbeat();
            if (!plant.operations) {
                sse.close();
                return;
            }
            const subscription = plant.operations.stream((event) => {
                if (event.type === 'created' && event.operation) {
                    sse.emit('operation_created', operationJson(event.operation));
                } else if (event.type === 'updated' && event.operation) {
                    sse.emit('operation_updated', operationJson(event.operation));
                } else if (event.type === 'deleted' && event.operation) {
                    sse.emit('operation_deleted', operationJson(event.operation));
                }
            });
            const heartbeat = setInterval(() => {
                sse.heartbeat();
            }, 30000);
            req.on('close', () => {
                clearInterval(heartbeat);
                subscription.cancel();
            });
        })
    ];
}
