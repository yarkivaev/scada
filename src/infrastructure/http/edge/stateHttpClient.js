import stateHttpTimeoutError from './stateHttpTimeoutError.js';

const DEFAULT_TIMEOUT_MS = 25000;

function trimBase(url) {
    return url.replace(/\/$/u, '');
}

function authHeaders(token, json) {
    const headers = {};
    if (json) {
        headers['Content-Type'] = 'application/json';
    }
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    return headers;
}

async function readError(res) {
    const text = await res.text();
    return text.length > 0 ? text : res.statusText;
}

function buildUrl(base, path, query) {
    const qs = new URLSearchParams(query).toString();
    return qs ? `${base}${path}?${qs}` : `${base}${path}`;
}

async function expectJson(res, verb, path) {
    if (!res.ok) {
        throw new Error(`supervisor state ${verb} ${path} failed: ${res.status} ${await readError(res)}`);
    }
    const payload = await res.json();
    return payload;
}

function resolveTimeoutMs(options) {
    if (options.timeoutMs === undefined || options.timeoutMs === null) {
        return DEFAULT_TIMEOUT_MS;
    }
    const ms = Number(options.timeoutMs);
    if (!Number.isFinite(ms) || ms <= 0) {
        return DEFAULT_TIMEOUT_MS;
    }
    return ms;
}

function isAbortTimeout(err) {
    return err && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

async function fetchJson(url, init, verb, path, limit) {
    const signal = AbortSignal.timeout(limit);
    try {
        return await fetch(url, { ...init, signal });
    } catch (err) {
        if (isAbortTimeout(err)) {
            throw stateHttpTimeoutError(verb, path, limit);
        }
        throw err;
    }
}

/**
 * HTTP client for supervisor-sink system state API (/v1).
 *
 * @param {object} options - connection options
 * @param {string} options.baseUrl - origin (no trailing slash)
 * @param {string} [options.token] - optional Bearer token
 * @param {number} [options.timeoutMs] - per-request deadline (default 25000)
 * @returns {object} frozen client with getJson patchJson postJson
 *
 * @example
 *   const client = stateHttpClient({ baseUrl: 'http://localhost:8081', token: 'secret' });
 *   const data = await client.getJson('/v1/alerts', {});
 */
export default function stateHttpClient(options) {
    const { baseUrl: rawBase, token } = options;
    const limit = resolveTimeoutMs(options);
    const base = trimBase(rawBase);
    async function getJson(path, query) {
        const url = buildUrl(base, path, query);
        const res = await fetchJson(url, { headers: authHeaders(token, false) }, 'GET', path, limit);
        return expectJson(res, 'GET', path);
    }
    async function patchJson(path, body) {
        const url = `${base}${path}`;
        const res = await fetchJson(url, {
            method: 'PATCH',
            headers: authHeaders(token, true),
            body: JSON.stringify(body)
        }, 'PATCH', path, limit);
        return expectJson(res, 'PATCH', path);
    }
    async function postJson(path, body) {
        const url = `${base}${path}`;
        const res = await fetchJson(url, {
            method: 'POST',
            headers: authHeaders(token, true),
            body: JSON.stringify(body)
        }, 'POST', path, limit);
        return expectJson(res, 'POST', path);
    }
    return Object.freeze({ getJson, patchJson, postJson, baseUrl: base, timeoutMs: limit });
}
