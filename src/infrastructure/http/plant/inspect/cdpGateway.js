import http from 'node:http';
import capturePng from './cdpShot.js';

/**
 * Loopback Host Chromium accepts for HTTP CDP.
 *
 * @param {number} port - debug port
 * @returns {string} Host header value
 *
 * @example
 *   cdpRequest({ host: '192.0.2.10', port: 9222 }, '/json/list');
 */
export function cdpRequest(target, path) {
    return {
        hostname: target.host,
        port: target.port,
        path,
        method: 'GET',
        headers: { Host: `127.0.0.1:${target.port}` }
    };
}

/**
 * Chooses ws or wss from Host and X-Forwarded-Proto.
 *
 * @param {string} hostHeader - incoming Host
 * @param {string} [proto] - forwarded proto
 * @returns {string} ws or wss
 *
 * @example
 *   schemeOf('scada.example');
 */
export function schemeOf(hostHeader, proto) {
    if (proto === 'https') {
        return 'wss';
    }
    if (proto === 'http') {
        return 'ws';
    }
    if (hostHeader.endsWith(':443')) {
        return 'wss';
    }
    return hostHeader.includes(':') ? 'ws' : 'wss';
}

/**
 * Rewrites CDP debugger URLs onto the same-origin inspect prefix.
 *
 * @param {string} text - upstream JSON or HTML
 * @param {string} hostHeader - incoming Host
 * @param {string} nodeId - topology node id
 * @param {string} [proto] - forwarded proto
 * @returns {string} rewritten body
 *
 * @example
 *   rewriteDebugger(body, 'example.test:443', 'm1');
 */
export function rewriteDebugger(text, hostHeader, nodeId, proto) {
    const scheme = schemeOf(hostHeader, proto);
    const httpScheme = scheme === 'wss' ? 'https' : 'http';
    const host = hostHeader.replace(/:443$/u, '').replace(/:80$/u, '');
    const prefix = `/infra/inspect/${nodeId}`;
    const origin = `${scheme}://${host}${prefix}`;
    const query = `${scheme}=${host}${prefix}`;
    const frontend = `${httpScheme}://${host}${prefix}/devtools/inspector.html`;
    return text
        .replace(/https:\/\/chrome-devtools-frontend\.appspot\.com\/serve_rev\/@[^"'?\s]+\/inspector\.html/gu, frontend)
        .replace(/"\/devtools\//gu, `"${prefix}/devtools/`)
        .replace(/wss?:\/\/127\.0\.0\.1:\d+/gu, origin)
        .replace(/(?:wss?)=127\.0\.0\.1:\d+/gu, query);
}

function readBody(res) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        res.on('data', (chunk) => {
            chunks.push(chunk);
        });
        res.on('end', () => {
            resolve(Buffer.concat(chunks));
        });
        res.on('error', reject);
    });
}

function requestCdp(target, path) {
    return new Promise((resolve, reject) => {
        const req = http.request(cdpRequest(target, path), (res) => {
            readBody(res).then((body) => {
                resolve({ status: res.statusCode, headers: res.headers, body });
            }, reject);
        });
        req.on('error', reject);
        req.end();
    });
}

/**
 * HTTP CDP client that forces a loopback Host and rewrites debugger URLs.
 *
 * @param {function} [requestImpl] - optional (target, path) => { status, headers, body }
 * @param {function} [shotImpl] - optional (target) => Buffer png
 * @returns {object} json, shot, proxy
 *
 * @example
 *   const body = await cdpGateway().json(target, '/json/list', 'example.test:443', 'm1');
 */
export default function cdpGateway(requestImpl, shotImpl) {
    const request = requestImpl || requestCdp;
    const shot = shotImpl || ((target) => {
        return capturePng(target, request);
    });
    return {
        async json(target, path, hostHeader, nodeId, proto) {
            const result = await request(target, path);
            return rewriteDebugger(result.body.toString('utf8'), hostHeader, nodeId, proto);
        },
        shot(target) {
            return shot(target);
        },
        proxy(target, path, res) {
            const req = http.request(cdpRequest(target, path), (up) => {
                res.writeHead(up.statusCode, up.headers);
                up.pipe(res);
            });
            req.on('error', (err) => {
                res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end(String(err));
            });
            req.end();
        }
    };
}
