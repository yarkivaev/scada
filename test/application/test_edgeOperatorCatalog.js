import assert from 'assert';
import http from 'http';
import { routes } from '@yarkivaev/simple-server';
import edgeOperatorCatalog from '../../src/application/edgeOperatorCatalog.js';

function mockRes() {
    return {
        headersSent: false,
        statusCode: 200,
        body: null,
        writeHead(code) {
            this.statusCode = code;
        },
        end(data) {
            this.body = data;
        },
        destroy() {}
    };
}

function mockReq(bodyText, meta) {
    const listeners = {};
    const req = {
        method: meta.method,
        url: meta.url,
        headers: meta.headers || {},
        on(event, fn) {
            listeners[event] = fn;
            if (listeners.end) {
                queueMicrotask(() => {
                    if (listeners.data) {
                        listeners.data(Buffer.from(bodyText));
                    }
                    listeners.end();
                });
            }
            return req;
        }
    };
    return req;
}

async function listen(server) {
    await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });
    return server.address().port;
}

describe('edgeOperatorCatalog', function() {
    it('POST operators proxies to central and appears in subsequent GET', async function() {
        const uid = `catalog-${Math.random().toString(36).slice(2)}`.toUpperCase();
        let stored = [];
        const registration = false;
        const central = http.createServer((req, res) => {
            if (req.method === 'GET' && req.url === '/api/v1/operators') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ items: stored }));
                return;
            }
            if (req.method === 'GET' && req.url === '/api/v1/operators/registration-enabled') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ enabled: registration }));
                return;
            }
            if (req.method === 'POST' && req.url === '/api/v1/operators') {
                let raw = '';
                req.on('data', (chunk) => {
                    raw += chunk;
                });
                req.on('end', () => {
                    const draft = JSON.parse(raw);
                    const row = {
                        id: 77,
                        cardUid: draft.cardUid,
                        firstName: draft.firstName,
                        lastName: draft.lastName,
                        displayName: draft.displayName
                    };
                    stored = [row];
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(row));
                });
                return;
            }
            res.writeHead(404);
            res.end();
        });
        const port = await listen(central);
        const catalog = edgeOperatorCatalog('/api/v1', {
            CENTRAL_PLANT_URL: `http://127.0.0.1:${port}`,
            OPERATORS_SYNC_INTERVAL_SEC: '3600'
        });
        await catalog.sync.start();
        const api = routes(catalog.routes);
        const createRes = mockRes();
        await api.handle(
            mockReq(
                JSON.stringify({
                    cardUid: uid,
                    firstName: 'Tanya',
                    lastName: 'Volkov',
                    displayName: 'Tanya Volkov'
                }),
                { method: 'POST', url: '/api/v1/operators' }
            ),
            createRes
        );
        const listRes = mockRes();
        await api.handle({ method: 'GET', url: '/api/v1/operators', headers: {} }, listRes);
        catalog.sync.stop();
        central.close();
        const created = JSON.parse(createRes.body);
        const listed = JSON.parse(listRes.body);
        assert.deepStrictEqual(
            { createStatus: createRes.statusCode, id: created.id, listed: listed.items[0].cardUid },
            { createStatus: 200, id: 77, listed: uid },
            'edge catalog did not proxy create and refresh GET list'
        );
    });

    it('GET registration-enabled exposes flag synced from central', async function() {
        const central = http.createServer((req, res) => {
            if (req.method === 'GET' && req.url === '/api/v1/operators') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ items: [] }));
                return;
            }
            if (req.method === 'GET' && req.url === '/api/v1/operators/registration-enabled') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ enabled: true }));
                return;
            }
            res.writeHead(404);
            res.end();
        });
        const port = await listen(central);
        const catalog = edgeOperatorCatalog('/api/v1', {
            CENTRAL_PLANT_URL: `http://127.0.0.1:${port}`,
            OPERATORS_SYNC_INTERVAL_SEC: '3600'
        });
        await catalog.sync.start();
        const api = routes(catalog.routes);
        const res = mockRes();
        await api.handle(
            { method: 'GET', url: '/api/v1/operators/registration-enabled', headers: {} },
            res
        );
        catalog.sync.stop();
        central.close();
        const payload = JSON.parse(res.body);
        assert.strictEqual(payload.enabled, true, 'edge catalog did not expose registration flag from central');
    });

    it('POST operators fails without CENTRAL_PLANT_URL and leaves GET empty', async function() {
        const catalog = edgeOperatorCatalog('/api/v1', {});
        const api = routes(catalog.routes);
        const createRes = mockRes();
        await api.handle(
            mockReq(
                JSON.stringify({
                    cardUid: `OFFLINE-${Math.random().toString(36).slice(2)}`,
                    firstName: 'Denis',
                    lastName: 'Krylov',
                    displayName: 'Denis Krylov'
                }),
                { method: 'POST', url: '/api/v1/operators' }
            ),
            createRes
        );
        const listRes = mockRes();
        await api.handle({ method: 'GET', url: '/api/v1/operators', headers: {} }, listRes);
        const listed = JSON.parse(listRes.body);
        assert.deepStrictEqual(
            { createStatus: createRes.statusCode, length: listed.items.length },
            { createStatus: 503, length: 0 },
            'edge catalog accepted create without central'
        );
    });
});
