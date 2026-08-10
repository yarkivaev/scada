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

function writeBody(start, tags, properties, audit) {
    const body = {
        start: start.toISOString(),
        tags: tags || [],
        properties: properties || {}
    };
    if (audit && audit.id !== undefined && audit.id !== null) {
        body.operatorId = audit.id;
    }
    return body;
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

/**
 * HTTP timeline write port that proxies retag/respond to an edge plant API.
 *
 * Matches stompTimeline shape: retag(start, tags, properties, audit) and
 * respond(start, tags, properties, audit). Failures surface as route errors.
 *
 * @param {object} site - edge owner with baseUrl and optional token/fetch
 * @param {string} machineId - machine identifier
 * @returns {object} timeline write port
 *
 * @example
 *   const port = httpTimeline({ baseUrl: 'http://edge/api/v1' }, 'm2');
 *   await port.retag(start, ['heat'], {}, audit);
 */
export default function httpTimeline(site, machineId) {
    const base = trimBase(site.baseUrl);
    const fetcher = site.fetch || fetch;
    async function send(method, path, body) {
        const url = `${base}${path}`;
        let res;
        try {
            res = await fetcher(url, {
                method,
                headers: authHeaders(site.token),
                body: JSON.stringify(body)
            });
        } catch (cause) {
            throw ownerError(
                `owner timeline unreachable for ${machineId}: ${cause.message}`,
                'SERVICE_UNAVAILABLE',
                503,
                cause
            );
        }
        if (!res.ok) {
            throw ownerError(
                `owner timeline ${method} ${path} for ${machineId} failed: ${res.status} ${await readError(res)}`,
                'BAD_GATEWAY',
                502
            );
        }
        return res;
    }
    return Object.freeze({
        async retag(start, tags, properties, audit) {
            await send('PATCH', `/machines/${encodeURIComponent(machineId)}/segments`, writeBody(start, tags, properties, audit));
        },
        async respond(start, tags, properties, audit) {
            const requestId = encodeURIComponent(start.toISOString());
            const body = {
                tags: tags || [],
                properties: properties || {}
            };
            if (audit && audit.id !== undefined && audit.id !== null) {
                body.operatorId = audit.id;
            }
            await send('POST', `/machines/${encodeURIComponent(machineId)}/requests/${requestId}/respond`, body);
        }
    });
}
