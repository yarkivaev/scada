function trimBase(url) {
    return String(url).replace(/\/$/u, '');
}

function listPath(root, query) {
    const params = new URLSearchParams();
    Object.keys(query || {}).forEach((name) => {
        const value = query[name];
        if (value !== undefined && value !== null && value !== '') {
            params.set(name, String(value));
        }
    });
    const suffix = params.toString();
    return suffix.length > 0 ? `${root}?${suffix}` : root;
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

function ownerContext(site, machineId) {
    return {
        base: trimBase(site.baseUrl),
        fetcher: site.fetch || fetch,
        token: site.token,
        machineId
    };
}

async function send(ctx, method, path, body) {
    const url = `${ctx.base}${path}`;
    let res;
    try {
        res = await ctx.fetcher(url, {
            method,
            headers: authHeaders(ctx.token),
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    } catch (cause) {
        throw ownerError(
            `owner operations unreachable for ${ctx.machineId}: ${cause.message}`,
            'SERVICE_UNAVAILABLE',
            503,
            cause
        );
    }
    if (!res.ok) {
        throw ownerError(
            `owner operations ${method} ${path} for ${ctx.machineId} failed: ${res.status} ${await readError(res)}`,
            'BAD_GATEWAY',
            502
        );
    }
    return readJson(res);
}

/**
 * HTTP operations port that proxies list/create/update/delete to an edge plant API.
 *
 * Matches the owning-edge contract: central never upserts locally for edge machines.
 * Failures surface as route errors (503 unreachable, 502 non-ok).
 *
 * @param {object} site - edge owner with baseUrl and optional token/fetch
 * @param {string} machineId - machine identifier
 * @returns {object} operations port
 *
 * @example
 *   const port = httpOperations({ baseUrl: 'http://edge/api/v1' }, 'm2');
 *   await port.create({ kind: 'load', payload: {}, operatorId: 2 });
 */
export default function httpOperations(site, machineId) {
    const ctx = ownerContext(site, machineId);
    const root = `/machines/${encodeURIComponent(machineId)}/operations`;
    return Object.freeze({
        list(query) {
            return send(ctx, 'GET', listPath(root, query));
        },
        create(body) {
            return send(ctx, 'POST', root, body);
        },
        createMany(body) {
            return send(ctx, 'POST', `${root}/batch`, body);
        },
        update(key, body) {
            return send(ctx, 'PUT', `${root}/${encodeURIComponent(key)}`, body);
        },
        remove(key, body) {
            return send(ctx, 'DELETE', `${root}/${encodeURIComponent(key)}`, body);
        },
        decisions(key) {
            return send(ctx, 'GET', `${root}/${encodeURIComponent(key)}/decisions`).then((body) => {
                return Array.isArray(body && body.items) ? body.items : [];
            });
        }
    });
}
