import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
function request(endpoint, route, body, options) {
    return new Promise((resolve, reject) => {
        const target = new URL(route, endpoint);
        const transport = target.protocol === 'https:' ? https : http;
        const req = transport.request(target, { method: 'POST', ...options.tls, headers: { 'content-type': 'application/json' } }, (res) => {
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
                    if (res.statusCode !== 200 || value.error) { reject(new Error('Control request rejected')); } else { resolve(value); }
                } catch (error) { reject(error); }
            });
        });
        const timer = setTimeout(() => { req.destroy(new Error('Control request deadline')); }, options.timeoutMs);
        req.on('error', reject);
        req.on('close', () => { clearTimeout(timer); });
        req.end(JSON.stringify(body));
    });
}
export default function controlClient({ endpoints, timeoutMs = 2000, maxBytes = 8388608, tls = {} }) {
    if (!Array.isArray(endpoints) || !endpoints.length || endpoints.some((endpoint) => { return !['http:', 'https:'].includes(new URL(endpoint).protocol); })) { throw new TypeError('Control endpoints required'); }
    let cursor = 0;
    return async (route, body) => {
        for (let index = 0; index < endpoints.length; index += 1) {
            try {
                // eslint-disable-next-line no-await-in-loop
                return await request(endpoints[cursor], route, body, { timeoutMs, maxBytes, tls });
            } catch (error) {
                cursor = (cursor + 1) % endpoints.length;
                if (index === endpoints.length - 1) { throw error; }
            }
        }
        throw new Error('No control endpoints');
    };
}
export function clientFromEnv(env, prefix = 'CONTROL') {
    const tls = {};
    for (const [name, key] of [['CA', 'ca'], ['CERT', 'cert'], ['KEY', 'key']]) {
        if (env[`${prefix}_${name}`]) { tls[key] = readFileSync(env[`${prefix}_${name}`]); }
    }
    return controlClient({ endpoints: (env[`${prefix}_ENDPOINTS`] ?? '').split(',').filter(Boolean), tls });
}
