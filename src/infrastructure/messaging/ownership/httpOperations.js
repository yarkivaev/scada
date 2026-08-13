function trimBase(url) {
    return String(url).replace(/\/$/u, '');
}

function authHeaders(token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    return headers;
}

function ownerError(message, code, status, cause) {
    const err = new Error(message);
    err.routeCode = code;
    err.routeStatus = status;
    if (cause) {
        err.cause = cause;
    }
    return err;
}

async function readError(res) {
    const text = await res.text();
    return text.length > 0 ? text : res.statusText;
}

async function readJson(res) {
    const text = await res.text();
    if (!text || text.trim().length === 0) {
        return undefined;
    }
    return JSON.parse(text);
}

/**
 * HTTP operations write port that proxies create/update/delete to an edge plant API.
 *
 * Matches the owning-edge contract: central never upserts locally for edge machines.
 * Failures surface as route errors (503 unreachable, 502 non-ok).
 *
 * @param {object} site - edge owner with baseUrl and optional token/fetch
 * @param {string} machineId - machine identifier
 * @returns {object} operations write port
 *
 * @example
 *   const port = httpOperations({ baseUrl: 'http://edge/api/v1' }, 'm2');
 *   await port.create({ kind: 'load', payload: {}, operatorId: 2 });
 */
export default function httpOperations(site, machineId) {
    const base = trimBase(site.baseUrl);
    const fetcher = site.fetch || fetch;
    async function send(method, path, body) {
        const url = `${base}${path}`;
        let res;
        try {
            res = await fetcher(url, {
                method,
                headers: authHeaders(site.token),
                body: body === undefined ? undefined : JSON.stringify(body)
            });
        } catch (cause) {
            throw ownerError(
                `owner operations unreachable for ${machineId}: ${cause.message}`,
                'SERVICE_UNAVAILABLE',
                503,
                cause
            );
        }
        if (!res.ok) {
            throw ownerError(
                `owner operations ${method} ${path} for ${machineId} failed: ${res.status} ${await readError(res)}`,
                'BAD_GATEWAY',
                502
            );
        }
        return readJson(res);
    }
    const root = `/machines/${encodeURIComponent(machineId)}/operations`;
    return Object.freeze({
        create(body) {
            return send('POST', root, body);
        },
        update(key, body) {
            return send('PUT', `${root}/${encodeURIComponent(key)}`, body);
        },
        remove(key, body) {
            return send('DELETE', `${root}/${encodeURIComponent(key)}`, body);
        },
        decisions(key) {
            return send('GET', `${root}/${encodeURIComponent(key)}/decisions`).then((body) => {
                return Array.isArray(body && body.items) ? body.items : [];
            });
        }
    });
}
