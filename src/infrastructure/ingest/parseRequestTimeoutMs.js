const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

/**
 * Parses REQUEST_TIMEOUT_MS from environment into a positive millisecond value.
 *
 * @param {string|undefined} raw - env value
 * @returns {number} timeout in milliseconds
 */
export function parseRequestTimeoutMs(raw) {
    if (raw === undefined || raw === null || raw === '') {
        return DEFAULT_REQUEST_TIMEOUT_MS;
    }
    const ms = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(ms) || ms <= 0) {
        return DEFAULT_REQUEST_TIMEOUT_MS;
    }
    return ms;
}

export { DEFAULT_REQUEST_TIMEOUT_MS };
