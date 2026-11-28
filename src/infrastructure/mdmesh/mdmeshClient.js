import { createHash } from 'node:crypto';

async function exchange(url, route, options) {
    try {
        return await fetch(`${url.replace(/\/$/u, '')}/rest${route}`, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) });
    } catch { throw new Error('MDMesh transport failed'); }
}

async function payload(response, context) {
    if (!response.ok) { throw new Error(`MDMesh ${context} refused with HTTP ${response.status}`); }
    let value;
    try { value = await response.json(); } catch { throw new Error(`MDMesh ${context} returned invalid JSON`); }
    return value;
}

function expire(session) {
    delete session.authentication;
}

async function authenticate(settings) {
    if (!settings.login || !settings.password) { throw new Error('MDMesh credentials are missing'); }
    const response = await exchange(settings.url, '/public/jwt/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: settings.login, password: createHash('md5').update(settings.password).digest('hex').toUpperCase() }) });
    const value = await payload(response, 'authentication');
    if (typeof value.id_token !== 'string' || !value.id_token) { throw new Error('MDMesh authentication returned no JWT'); }
    return value.id_token;
}

async function inventory(request, page = 1, devices = []) {
    if (page > 200) { throw new Error('MDMesh inventory exceeded bounded pagination'); }
    const value = await request('/private/devices/search', 'POST', { value: '', pageNum: page, pageSize: 50 });
    if (!Array.isArray(value?.devices?.items) || !Number.isSafeInteger(value.devices.totalItemsCount)
        || value.devices.totalItemsCount < 0) { throw new Error('MDMesh inventory returned invalid pagination'); }
    const combined = [...devices, ...value.devices.items];
    if (page * 50 >= value.devices.totalItemsCount) { return combined; }
    return inventory(request, page + 1, combined);
}

function form(filename, content) {
    const body = new FormData();
    body.append('file', new Blob([content], { type: 'text/plain' }), filename);
    return body;
}

function envelope(value) {
    if (value?.status !== 'OK') { throw new Error('MDMesh request returned an unsuccessful envelope'); }
    return value.data;
}

async function bearer(settings, session) {
    session.authentication ||= authenticate(settings).catch(() => { expire(session); throw new Error('MDMesh authentication failed'); });
    return await session.authentication;
}

/** Authenticated v0.4.0 REST adapter; upstream messages and credentials never enter errors. */
export default function mdmeshClient(settings) {
    const session = {};
    async function request(route, method = 'GET', body = undefined, retry = true) {
        const token = await bearer(settings, session);
        const response = await exchange(settings.url, route, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            ...(body !== undefined && { body: JSON.stringify(body) }) });
        if (retry && [401, 403].includes(response.status)) { expire(session); return request(route, method, body, false); }
        return envelope(await payload(response, 'request'));
    }
    async function upload(filename, content, retry = true) {
        const token = await bearer(settings, session);
        const response = await exchange(settings.url, '/private/web-ui-files/raw', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form(filename, content) });
        if (retry && [401, 403].includes(response.status)) { expire(session); return upload(filename, content, false); }
        return envelope(await payload(response, 'upload'));
    }
    return { request, upload, inventory: () => { return inventory(request); } };
}
