import sseConnection from './sseConnection.js';

/**
 * Builds a JSON request payload with method, headers, and body.
 *
 * @param {string} method - HTTP method
 * @param {object} data - request body data
 * @returns {object} fetch options with method, headers, and stringified body
 */
function payload(method, data) {
    return {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    };
}

/**
 * Maps camelCase createOperation fields to snake_case API body.
 *
 * @param {object} fields - kind, payload, optional occurredAt and key
 * @returns {object} POST body for /operations
 */
function createBody(fields) {
    const data = {
        kind: fields.kind,
        payload: fields.payload
    };
    if (fields.occurredAt !== undefined) {
        data.occurred_at = fields.occurredAt;
    }
    if (fields.key !== undefined) {
        data.key = fields.key;
    }
    return data;
}

/**
 * Machine operations list, create, and plant-wide SSE subscription methods.
 *
 * @param {string} baseUrl - API base URL
 * @param {function} request - authenticated JSON request helper
 * @param {function} eventSource - EventSource constructor
 * @param {object} [logger] - optional logger with error(tag, detail)
 * @returns {object} operations, createOperation, and operationsStream methods
 *
 * @example
 *   const ops = machineOperationsClient(baseUrl, request, EventSource, logger);
 *   const items = await ops.operations({ kind: 'chem' });
 *   await ops.createOperation({ kind: 'bath', payload: { action: 'load' } });
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
        createOperation(fields) {
            return request('/operations', payload('POST', createBody(fields)));
        },
        operationsStream(callback) {
            const conn = sseConnection(`${baseUrl}/operations/stream`, eventSource, logger);
            conn.on('operation_created', callback);
            conn.on('operation_updated', callback);
            return conn;
        }
    };
}
