import { route, sseResponse } from '@yarkivaev/simple-server';

/**
 * Heartbeat stream route factory.
 * Creates SSE route for /heartbeat/stream that sends periodic heartbeat events.
 * Used by frontend watchdog to detect connection loss.
 *
 * @param {string} basePath - base URL path
 * @param {function} clock - time provider
 * @param {number} period - interval between heartbeats in milliseconds (default: 5000)
 * @returns {array} array of route objects
 *
 * @example
 *   const routes = heartbeatStream('/api/v1', () => new Date(), 1000);
 */
export default function heartbeatStream(basePath, clock, period) {
    const ms = period || 5000;
    return [
        route(
            'GET',
            `${basePath}/heartbeat/stream`,
            (req, res) => {
                const sse = sseResponse(res, clock);
                sse.heartbeat();
                const interval = setInterval(() => {
                    sse.heartbeat();
                }, ms);
                req.on('close', () => {
                    clearInterval(interval);
                });
            }
        )
    ];
}
