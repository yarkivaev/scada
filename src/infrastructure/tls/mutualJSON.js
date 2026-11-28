import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:https';

const defaultLimit = 1024 * 1024;

export function readMutualTLS({ key, cert, ca }) {
    try {
        return { key: readFileSync(key), cert: readFileSync(cert), ca: readFileSync(ca), minVersion: 'TLSv1.2' };
    } catch { throw new Error('Mutual TLS files are required'); }
}

function respond(response, status, body) {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(body);
}

async function respondJSON(response, { read, maxBytes = defaultLimit, unavailable }) {
    try {
        const result = await read();
        if (result === undefined) {
            respond(response, 404, '{"error":"Not found"}');
            return;
        }
        const body = JSON.stringify(result);
        if (Buffer.byteLength(body) > maxBytes) { throw new Error('JSON body limit exceeded'); }
        respond(response, 200, body);
    } catch { respond(response, 503, JSON.stringify({ error: unavailable || 'Resource unavailable' })); }
}

export function serveMutualTLS({ tls, routes }) {
    const server = createServer({ ...tls, requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, (incoming, response) => {
        if (!incoming.socket.authorized) { respond(response, 403, '{"error":"Client certificate required"}'); }
        else if (incoming.method !== 'GET') { respond(response, 405, '{"error":"Method not allowed"}'); }
        else if (Object.hasOwn(routes, incoming.url)) { void respondJSON(response, routes[incoming.url]); }
        else { respond(response, 404, '{"error":"Not found"}'); }
    });
    server.requestTimeout = 30000;
    server.headersTimeout = 10000;
    server.maxConnections = 8;
    return server;
}

function collect(response, resolve, reject, maxBytes, decode) {
    const chunks = [];
    let size = 0;
    response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) { response.destroy(new Error('JSON body limit exceeded')); }
        else { chunks.push(chunk); }
    });
    response.on('error', () => { reject(new Error('HTTPS transport failed')); });
    response.on('end', () => {
        try { resolve(decode(JSON.parse(Buffer.concat(chunks).toString('utf8')))); }
        catch { reject(new Error('HTTPS JSON response is invalid')); }
    });
}

export async function fetchMutualJSON({ url, tls, maxBytes = defaultLimit, path, decode = (value) => { return value; }, optional }) {
    const address = new URL(url);
    if (address.protocol !== 'https:' || address.username || address.password) {
        throw new Error('JSON transport requires HTTPS without credentials');
    }
    if (address.pathname !== path || address.search || address.hash) {
        throw new Error(`JSON transport requires the ${path} endpoint`);
    }
    return await new Promise((resolve, reject) => {
        const connection = request(address, {
            ...tls, method: 'GET', rejectUnauthorized: true, minVersion: 'TLSv1.2', timeout: 20000, agent: false
        }, (response) => {
            if (optional && response.statusCode === 404) { response.resume(); resolve(null); return; }
            if (response.statusCode !== 200 || !response.headers['content-type']?.startsWith('application/json')) {
                response.resume(); reject(new Error('HTTPS endpoint refused the request')); return;
            }
            collect(response, resolve, reject, maxBytes, decode);
        });
        connection.on('timeout', () => { connection.destroy(new Error('HTTPS request timed out')); });
        connection.on('error', () => { reject(new Error('HTTPS transport failed')); });
        connection.end();
    });
}
