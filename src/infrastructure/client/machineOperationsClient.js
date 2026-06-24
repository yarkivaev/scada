import sseConnection from './sseConnection.js';

/**
 * Machine operations list and plant-wide SSE subscription methods.
 *
 * @param {string} baseUrl - API base URL
 * @param {function} request - authenticated JSON request helper
 * @param {function} eventSource - EventSource constructor
 * @param {object} [logger] - optional logger with error(tag, detail)
 * @returns {object} operations and operationsStream methods
 *
 * @example
 *   const ops = machineOperationsClient(baseUrl, request, EventSource, logger);
 *   const items = await ops.operations({ kind: 'chem' });
 */
export default function machineOperationsClient(baseUrl, request, eventSource, logger) {
    return {
        operations(options) {
            const params = new URLSearchParams();
            if (options && options.kind) {
                params.set('kind', options.kind);
            }
            if (options && options.from) {
                params.set('from', options.from);
            }
            if (options && options.to) {
                params.set('to', options.to);
            }
            const qs = params.toString();
            return request(`/operations${qs ? `?${qs}` : ''}`).then((body) => {
                return body.items;
            });
        },
        operationsStream(callback) {
            const conn = sseConnection(`${baseUrl}/operations/stream`, eventSource, logger);
            conn.on('operation_created', callback);
            conn.on('operation_updated', callback);
            return conn;
        }
    };
}
