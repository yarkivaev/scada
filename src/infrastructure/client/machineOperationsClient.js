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
 * Copies optional audit fields onto an API body.
 *
 * @param {object} data - mutable body
 * @param {object} fields - create/update/delete fields
 */
function attachAudit(data, fields) {
    if (fields.operatorId !== undefined) {
        data.operatorId = fields.operatorId;
    }
    if (fields.client !== undefined) {
        data.client = fields.client;
    }
}

/**
 * Maps camelCase createOperation fields to snake_case API body.
 *
 * @param {object} fields - kind, payload, optional occurredAt, key, operatorId, client
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
    attachAudit(data, fields);
    return data;
}

/**
 * Maps camelCase updateOperation fields to snake_case API body.
 *
 * @param {object} fields - payload, optional kind, occurredAt, operatorId, client
 * @returns {object} PUT body for /operations/:key
 */
function updateBody(fields) {
    const data = {
        payload: fields.payload
    };
    if (fields.kind !== undefined) {
        data.kind = fields.kind;
    }
    if (fields.occurredAt !== undefined) {
        data.occurred_at = fields.occurredAt;
    }
    attachAudit(data, fields);
    return data;
}

/**
 * Machine operations list, create, update, delete, decisions, and SSE methods.
 *
 * @param {string} baseUrl - API base URL
 * @param {function} request - authenticated JSON request helper
 * @param {function} eventSource - EventSource constructor
 * @param {object} [logger] - optional logger with error(tag, detail)
 * @returns {object} operations client methods
 *
 * @example
 *   const ops = machineOperationsClient(baseUrl, request, EventSource, logger);
 *   await ops.createOperation({ kind: 'bath', payload: {}, operatorId: 2 });
 *   await ops.operationDecisions(key);
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
        updateOperation(key, fields) {
            return request(
                `/operations/${encodeURIComponent(key)}`,
                payload('PUT', updateBody(fields))
            );
        },
        deleteOperation(key, fields) {
            const audit = fields || {};
            const data = {};
            attachAudit(data, audit);
            if (Object.keys(data).length === 0) {
                return request(`/operations/${encodeURIComponent(key)}`, { method: 'DELETE' });
            }
            return request(
                `/operations/${encodeURIComponent(key)}`,
                payload('DELETE', data)
            );
        },
        operationDecisions(key) {
            return request(`/operations/${encodeURIComponent(key)}/decisions`).then((body) => {
                return body.items;
            });
        },
        operationsStream(callback) {
            const conn = sseConnection(`${baseUrl}/operations/stream`, eventSource, logger);
            conn.on('operation_created', callback);
            conn.on('operation_updated', callback);
            conn.on('operation_deleted', callback);
            return conn;
        }
    };
}
