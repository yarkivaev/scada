import { parseRequestTimeoutMs } from '@yarkivaev/simple-server';

const DEFAULT_STATE_HTTP_TIMEOUT_MS = 25000;

/**
 * Resolves outbound supervisor-sink client timeout from environment.
 *
 * @param {NodeJS.ProcessEnv} env - process environment
 * @returns {number} timeout in milliseconds
 */
export default function parseStateHttpTimeoutMs(env = process.env) {
    if (env.STATE_HTTP_TIMEOUT_MS !== undefined && env.STATE_HTTP_TIMEOUT_MS !== '') {
        return parseRequestTimeoutMs(env.STATE_HTTP_TIMEOUT_MS);
    }
    if (env.REQUEST_TIMEOUT_MS !== undefined && env.REQUEST_TIMEOUT_MS !== '') {
        const total = parseRequestTimeoutMs(env.REQUEST_TIMEOUT_MS);
        return Math.max(1000, Math.floor(total / 2));
    }
    return DEFAULT_STATE_HTTP_TIMEOUT_MS;
}
