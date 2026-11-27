/** Authenticated HTTP transport for the management application. */
import { timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { endpoint, loopback, request } from './protocol.js';

const maxBodyBytes = 8192;

function matches(value, token) {
    const actual = Buffer.from(value ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    return Boolean(token) && actual.length === expected.length && timingSafeEqual(actual, expected);
}

function reply(res, status, data) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
}

async function readCommand(req) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        bytes += chunk.length;
        if (bytes > maxBodyBytes) {
            req.resume();
            throw new Error('request too large');
        }
        chunks.push(chunk);
    }
    return request.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

async function execute(res, service, command) {
    try {
        reply(res, 200, await service.execute(command));
    } catch (error) {
        reply(res, 422, { error: error.message });
    }
}

async function accept(req, res, service, credentials) {
    if (req.url !== endpoint || req.method !== 'POST') {
        reply(res, 404, { error: 'unknown management endpoint' });
        return;
    }
    const admin = matches(req.headers.authorization, credentials.token);
    if (!admin && !matches(req.headers.authorization, credentials.readToken)) {
        reply(res, 401, { error: 'unauthorized' });
        return;
    }
    const command = await readCommand(req).catch(() => { return null; });
    if (!command) {
        reply(res, 400, { error: 'invalid management command' });
        return;
    }
    if (command.action === 'apply' && !admin) {
        reply(res, 403, { error: 'forbidden' });
        return;
    }
    await execute(res, service, command);
}

export default async function managementServer(service, { host, port, tls, token, readToken }) {
    if (!tls && !loopback(host)) {
        throw new Error('a non-loopback listener requires --cert and --key');
    }
    if (!token && !readToken) {
        throw new Error('set SCADA_TOKEN or SCADA_READ_TOKEN for the management server');
    }
    if (token && token === readToken) {
        throw new Error('read and write credentials must differ');
    }
    const options = { requestTimeout: 15000, headersTimeout: 10000 };
    const server = tls ? httpsServer({ ...options, ...tls }) : httpServer(options);
    server.on('request', (req, res) => { void accept(req, res, service, { token, readToken }); });
    server.listen(port, host);
    await once(server, 'listening');
    const { address } = server.address();
    const hostname = address.includes(':') ? `[${address}]` : address;
    return { server, address: `${tls ? 'https' : 'http'}://${hostname}:${server.address().port}` };
}
