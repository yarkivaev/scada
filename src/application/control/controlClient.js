import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
function request(endpoint, route, body, options) {
    return new Promise((resolve, reject) => {
        const target = new URL(route, endpoint);
        const transport = target.protocol === 'https:' ? https : http;
        const req = transport.request(target, { method: 'POST', ...options.tls, headers: { 'content-type': 'application/json', ...(options.token && { Authorization: options.token }) } }, (res) => {
            const chunks = [];
            let bytes = 0;
            res.on('data', (chunk) => {
                bytes += chunk.length;
                if (bytes > options.maxBytes) { req.destroy(new Error('Control response capacity exceeded')); } else { chunks.push(chunk); }
            });
            res.on('error', reject);
            res.on('end', () => {
                try {
                    const value = JSON.parse(Buffer.concat(chunks).toString());
                    if (res.statusCode !== 200 || value.error) { const error = new Error('Control request rejected'); error.gatewayCode = value.code; error.statusCode = res.statusCode; reject(error); } else { resolve(value); }
                } catch { reject(new Error('Invalid control response')); }
            });
        });
        const timer = setTimeout(() => { req.destroy(new Error('Control request deadline')); }, options.timeoutMs);
        req.on('error', reject);
        req.on('close', () => { clearTimeout(timer); });
        req.end(JSON.stringify(body));
    });
}
function authenticated(send, username, password) {
    const state = { token: null, expiresAt: 0, pending: null };
    function token() {
        if (state.token && Date.now() < state.expiresAt) { return state.token; }
        state.pending ??= send('/v3/auth/authenticate', { name: username, password }).then((result) => {
            if (typeof result.token !== 'string' || !result.token) { throw new Error('Control authentication rejected'); }
            Object.assign(state, { token: result.token, expiresAt: Date.now() + 60000 });
            return result.token;
        }).finally(() => { state.pending = null; });
        return state.pending;
    }
    return async (route, body) => {
        const current = await token();
        try { return await send(route, body, current); } catch (error) {
            if (Number(error.gatewayCode) !== 16 && error.statusCode !== 401) { throw error; }
            if (state.token === current) { Object.assign(state, { token: null, expiresAt: 0 }); }
            return send(route, body, await token());
        }
    };
}
export default function controlClient({ endpoints, timeoutMs = 2000, maxBytes = 8388608, tls = {}, username, password }) {
    if (!Array.isArray(endpoints) || !endpoints.length || endpoints.some((endpoint) => { return !['http:', 'https:'].includes(new URL(endpoint).protocol); })) { throw new TypeError('Control endpoints required'); }
    if ((username !== undefined || password !== undefined) && (typeof username !== 'string' || !username || typeof password !== 'string' || !password)) {
        throw new TypeError('Complete control credentials required');
    }
    let cursor = 0;
    async function send(route, body, token) {
        for (let index = 0; index < endpoints.length; index += 1) {
            try {
                // eslint-disable-next-line no-await-in-loop
                return await request(endpoints[cursor], route, body, { timeoutMs, maxBytes, tls, token });
            } catch (error) {
                cursor = (cursor + 1) % endpoints.length;
                if (index === endpoints.length - 1) { throw error; }
            }
        }
        throw new Error('No control endpoints');
    }
    return username === undefined ? send : authenticated(send, username, password);
}
export function clientFromEnv(env, prefix = 'CONTROL') {
    const tls = {};
    for (const [name, key] of [['CA', 'ca'], ['CERT', 'cert'], ['KEY', 'key']]) {
        if (env[`${prefix}_${name}`]) { tls[key] = readFileSync(env[`${prefix}_${name}`]); }
    }
    return controlClient({ endpoints: (env[`${prefix}_ENDPOINTS`] ?? '').split(',').filter(Boolean), tls, username: env[`${prefix}_USERNAME`], password: env[`${prefix}_PASSWORD`] });
}
