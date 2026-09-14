import http from 'node:http';

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
 * Rewrites CDP debugger URLs onto the same-origin inspect prefix.
 *
 * @param {string} text - upstream JSON or HTML
 * @param {string} hostHeader - incoming Host
 * @param {string} nodeId - topology node id
 * @returns {string} rewritten body
 *
 * @example
 *   rewriteDebugger(body, 'example.test:443', 'm1');
 */
export function rewriteDebugger(text, hostHeader, nodeId) {
    const secure = hostHeader.endsWith(':443');
    const scheme = secure ? 'wss' : 'ws';
    const host = hostHeader.replace(/:443$/u, '').replace(/:80$/u, '');
    const prefix = `/infra/inspect/${nodeId}`;
    const origin = `${scheme}://${host}${prefix}`;
    const query = `$<scheme>=${host}${prefix}`;
    return text
        .replace(/"\/devtools\//gu, `"${prefix}/devtools/`)
        .replace(/wss?:\/\/127\.0\.0\.1:\d+/gu, origin)
        .replace(/(?<scheme>wss?)=127\.0\.0\.1:\d+/gu, query);
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

function capturePng(wsUrl) {
    return new Promise((resolve, reject) => {
        const socket = new globalThis.WebSocket(wsUrl);
        const timer = setTimeout(() => {
            socket.close();
            reject(new Error(`cdp screenshot timed out for ${wsUrl}`));
        }, 10000);
        socket.addEventListener('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
        socket.addEventListener('open', () => {
            socket.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
        });
        socket.addEventListener('message', (event) => {
            const message = JSON.parse(String(event.data));
            if (message.id !== 1) {
                return;
            }
            clearTimeout(timer);
            socket.close();
            resolve(Buffer.from(message.result.data, 'base64'));
        });
    });
}

async function defaultShot(target, requestImpl) {
    const listed = await requestImpl(target, '/json/list');
    const pages = JSON.parse(listed.body.toString('utf8'));
    const page = Array.isArray(pages) ? pages[0] : pages;
    if (!page || !page.webSocketDebuggerUrl) {
        throw new Error(`cdp page websocket is missing on ${target.host}:${target.port}`);
    }
    const wsUrl = page.webSocketDebuggerUrl.replace(/wss?:\/\/127\.0\.0\.1:\d+/u, `ws://${target.host}:${target.port}`);
    return capturePng(wsUrl);
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
        return defaultShot(target, request);
    });
    return {
        async json(target, path, hostHeader, nodeId) {
            const result = await request(target, path);
            return rewriteDebugger(result.body.toString('utf8'), hostHeader, nodeId);
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
