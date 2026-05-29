/**
 * Error for supervisor-sink HTTP client deadline exceeded.
 *
 * @param {string} verb - HTTP method
 * @param {string} path - request path
 * @param {number} limit - timeout milliseconds
 * @returns {Error} error with code TIMEOUT
 */
export default function stateHttpTimeoutError(verb, path, limit) {
    const err = new Error(`supervisor state ${verb} ${path} exceeded ${limit}ms`);
    err.code = 'TIMEOUT';
    return err;
}
