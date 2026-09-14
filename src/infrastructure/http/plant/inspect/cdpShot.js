import http from 'node:http';
import crypto from 'node:crypto';

function encode(text) {
    const payload = Buffer.from(text, 'utf8');
    const mask = crypto.randomBytes(4);
    const size = payload.length < 126 ? payload.length : 126;
    const head = payload.length < 126
        ? Buffer.from([0x81, 0x80 | size])
        : Buffer.concat([Buffer.from([0x81, 0x80 | 126]), Buffer.from([payload.length >> 8, payload.length & 255])]);
    const masked = Buffer.from(payload);
    for (let i = 0; i < payload.length; i += 1) {
        masked[i] ^= mask[i % 4];
    }
    return Buffer.concat([head, mask, masked]);
}

function header(buf) {
    if (buf.length < 2) {
        return undefined;
    }
    const code = buf[1] & 127;
    if (code < 126) {
        return { len: code, offset: 2 };
    }
    if (code === 126 && buf.length >= 4) {
        return { len: buf.readUInt16BE(2), offset: 4 };
    }
    if (code === 127 && buf.length >= 10) {
        return { len: Number(buf.readBigUInt64BE(2)), offset: 10 };
    }
    return undefined;
}

function decode(buf) {
    const meta = header(buf);
    if (!meta || buf.length < meta.offset + meta.len) {
        return undefined;
    }
    const opcode = buf[0] & 15;
    if (opcode !== 1 && opcode !== 2) {
        return undefined;
    }
    return buf.subarray(meta.offset, meta.offset + meta.len);
}

function openSocket(target, path) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: target.host,
            port: target.port,
            path,
            method: 'GET',
            headers: {
                Host: `127.0.0.1:${target.port}`,
                Connection: 'Upgrade',
                Upgrade: 'websocket',
                'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
                'Sec-WebSocket-Version': '13'
            }
        });
        req.on('upgrade', (res, socket) => {
            resolve(socket);
        });
        req.on('error', reject);
        req.end();
    });
}

function pathOf(wsUrl) {
    return new URL(wsUrl.replace(/^wss:/u, 'http:').replace(/^ws:/u, 'http:')).pathname;
}

/**
 * Captures a PNG screenshot over CDP without a global WebSocket constructor.
 *
 * @param {object} target - inspect { host, port }
 * @param {function} requestImpl - (target, path) => { body }
 * @returns {Promise<Buffer>} png bytes
 *
 * @example
 *   await capturePng({ host: '127.0.0.1', port: 9222 }, requestCdp);
 */
export default async function capturePng(target, requestImpl) {
    const listed = await requestImpl(target, '/json/list');
    const pages = JSON.parse(listed.body.toString('utf8'));
    const page = Array.isArray(pages) ? pages[0] : pages;
    if (!page || !page.webSocketDebuggerUrl) {
        throw new Error(`cdp page websocket is missing on ${target.host}:${target.port}`);
    }
    const socket = await openSocket(target, pathOf(page.webSocketDebuggerUrl));
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error(`cdp screenshot timed out for ${target.host}:${target.port}`));
        }, 10000);
        const chunks = [];
        socket.on('data', (chunk) => {
            chunks.push(chunk);
            const payload = decode(Buffer.concat(chunks));
            if (!payload) {
                return;
            }
            const message = JSON.parse(payload.toString('utf8'));
            if (message.id !== 1) {
                return;
            }
            clearTimeout(timer);
            socket.destroy();
            resolve(Buffer.from(message.result.data, 'base64'));
        });
        socket.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
        socket.write(encode(JSON.stringify({
            id: 1,
            method: 'Page.captureScreenshot',
            params: { format: 'png' }
        })));
    });
}
