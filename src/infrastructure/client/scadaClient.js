import machineClient from './machineClient.js';
import sseConnection from './sseConnection.js';

/**
 * Main SCADA API client.
 * Returns object with machines() and machine() methods.
 *
 * @param {string} baseUrl - server base URL
 * @param {function} fetcher - fetch function
 * @param {function} eventSource - EventSource constructor
 * @param {object} [logger] - optional logger with error(tag, detail)
 * @returns {object} client with machines, machine, jump, reset, simulation methods
 *
 * @example
 *   const client = scadaClient('http://localhost:3000/api/v1', fetch, EventSource, logger);
 *   const machines = await client.machines();
 *   const machine = client.machine('icht1');
 *   await client.jump('2025-06-15T10:00:00Z');
 *   await client.reset();
 */
export default function scadaClient(baseUrl, fetcher, eventSource, logger) {
    async function requestJson(path, options) {
        const fullPath = `${baseUrl}${path}`;
        let response;
        try {
            response = await fetcher(fullPath, options);
        } catch (cause) {
            if (logger && typeof logger.error === 'function') {
                logger.error('api.network', { path: fullPath, cause });
            }
            throw cause;
        }
        const payload = await response.json();
        if (!response.ok) {
            if (logger && typeof logger.error === 'function') {
                logger.error('api', { path: fullPath, body: payload });
            }
            const error = new Error(payload.error.message);
            error.code = payload.error.code;
            throw error;
        }
        return payload;
    }
    return {
        machines() {
            return requestJson('/machines');
        },
        machine(machineId) {
            return machineClient(baseUrl, machineId, fetcher, eventSource, logger);
        },
        jump(timestamp) {
            return requestJson('/simulation/jump', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ timestamp })
            });
        },
        reset() {
            return requestJson('/simulation', { method: 'DELETE' });
        },
        heartbeatStream() {
            return sseConnection(`${baseUrl}/heartbeat/stream`, eventSource, logger);
        },
        simulation() {
            return requestJson('/simulation');
        }
    };
}
