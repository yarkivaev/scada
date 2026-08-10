import sseConnection from './sseConnection.js';
import machineOperationsClient from './machineOperationsClient.js';

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
 * Builds a from/to query suffix for range GETs.
 *
 * @param {object} [options] - optional from/to timestamps
 * @returns {string} empty string or ?from=&to= suffix
 */
function rangeQuery(options) {
    const params = new URLSearchParams();
    if (options && options.from) {
        params.set('from', options.from);
    }
    if (options && options.to) {
        params.set('to', options.to);
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '';
}

/**
 * Client for single machine endpoints.
 * Returns object with methods for machine operations.
 *
 * @param {string} baseUrl - API base URL
 * @param {string} machineId - machine identifier
 * @param {function} fetcher - fetch function
 * @param {function} eventSource - EventSource constructor
 * @param {object} [logger] - optional logger with error(tag, detail)
 * @returns {object} client with info, measurements, alerts, segments, cycles, operations methods
 *
 * @example
 *   const machine = machineClient(baseUrl, 'm1', fetch, EventSource, logger);
 *   const info = await machine.info();
 *   await machine.createOperation({ kind: 'bath', payload: { action: 'load' } });
 *   await machine.updateOperation(key, { payload: { action: 'load' } });
 *   await machine.deleteOperation(key);
 */
export default function machineClient(baseUrl, machineId, fetcher, eventSource, logger) {
    const url = `${baseUrl}/machines/${machineId}`;
    async function request(path, options) {
        const fullPath = `${url}${path}`;
        let response;
        try {
            response = await fetcher(fullPath, options);
        } catch (cause) {
            if (logger && typeof logger.error === 'function') {
                logger.error('api.network', { path: fullPath, cause });
            }
            throw cause;
        }
        const result = await response.json();
        if (!response.ok) {
            if (logger && typeof logger.error === 'function') {
                logger.error('api', { path: fullPath, body: result });
            }
            throw result;
        }
        return result;
    }
    return {
        info() {
            return request('');
        },
        measurements(options) {
            const params = new URLSearchParams();
            if (options && options.keys) {
                params.set('keys', options.keys.join(','));
            }
            if (options && options.from) {
                params.set('from', options.from);
            }
            if (options && options.to) {
                params.set('to', options.to);
            }
            if (options && options.step) {
                params.set('step', String(options.step));
            }
            const qs = params.toString();
            return request(`/measurements${qs ? `?${qs}` : ''}`);
        },
        measurementStream(options) {
            const params = new URLSearchParams();
            if (options && options.keys) {
                params.set('keys', options.keys.join(','));
            }
            if (options && options.since) {
                params.set('since', options.since);
            }
            if (options && options.step) {
                params.set('step', String(options.step));
            }
            const qs = params.toString();
            return sseConnection(
                `${url}/measurements/stream${qs ? `?${qs}` : ''}`,
                eventSource,
                logger
            );
        },
        alerts(options) {
            const params = new URLSearchParams();
            if (options && options.page) {
                params.set('page', String(options.page));
            }
            if (options && options.size) {
                params.set('size', String(options.size));
            }
            if (options && Object.hasOwn(options, 'acknowledged')) {
                params.set('acknowledged', String(options.acknowledged));
            }
            const qs = params.toString();
            return request(`/alerts${qs ? `?${qs}` : ''}`);
        },
        alertStream() {
            return sseConnection(`${url}/alerts/stream`, eventSource, logger);
        },
        acknowledge(alertId) {
            return request(`/alerts/${alertId}`, payload('PATCH', { acknowledged: true }));
        },
        segments(options) {
            return request(`/segments${rangeQuery(options)}`);
        },
        cycles(options) {
            return request(`/cycles${rangeQuery(options)}`);
        },
        retag(data) {
            return request('/segments', payload('PATCH', data));
        },
        segmentStream() {
            return sseConnection(`${url}/segments/stream`, eventSource, logger);
        },
        requests() {
            return request('/requests');
        },
        requestStream() {
            return sseConnection(`${url}/requests/stream`, eventSource, logger);
        },
        respond(requestId, data) {
            return request(`/requests/${requestId}/respond`, payload('POST', data));
        },
        ...machineOperationsClient(baseUrl, request, eventSource, logger)
    };
}
