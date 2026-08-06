import assert from 'assert';
import http from 'http';
import centralOperators from '../../../src/infrastructure/operators/centralOperators.js';
import stateHttpClient from '../../../src/infrastructure/http/edge/stateHttpClient.js';

describe('centralOperators', function() {
    it('pull maps central operators json to domain records', async function() {
        const uid = `central-${Math.random()}`;
        const payload = {
            items: [{
                id: 7,
                cardUid: uid,
                firstName: 'Анна',
                lastName: 'Кузнецова',
                displayName: 'Анна Кузнецова'
            }]
        };
        const server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(payload));
        });
        await new Promise((resolve) => {
            server.listen(0, resolve);
        });
        const { port } = server.address();
        const client = stateHttpClient({ baseUrl: `http://127.0.0.1:${port}` });
        const source = centralOperators(client, '/api/v1');
        const rows = await source.pull();
        server.close();
        assert.strictEqual(rows[0].cardUid, uid, 'central operators did not map operator card uid');
    });

    it('pull keeps plant-owned fields from central operator json', async function() {
        const uid = `extra-${Math.random()}`;
        const code = `plant-${Math.random().toString(36).slice(2)}`;
        const payload = {
            items: [{
                id: 3,
                cardUid: uid,
                firstName: 'Никита',
                lastName: 'Орлов',
                displayName: 'Никита Орлов',
                plantCode: code
            }]
        };
        const server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(payload));
        });
        await new Promise((resolve) => {
            server.listen(0, resolve);
        });
        const { port } = server.address();
        const client = stateHttpClient({ baseUrl: `http://127.0.0.1:${port}` });
        const source = centralOperators(client, '/api/v1');
        const rows = await source.pull();
        server.close();
        assert.strictEqual(
            rows[0].plantCode,
            code,
            'central operators dropped plant-owned fields during pull'
        );
    });

    it('pull rejects response without items array', async function() {
        const server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ rows: [] }));
        });
        await new Promise((resolve) => {
            server.listen(0, resolve);
        });
        const { port } = server.address();
        const client = stateHttpClient({ baseUrl: `http://127.0.0.1:${port}` });
        const source = centralOperators(client, '/api/v1');
        let threw = false;
        try {
            await source.pull();
        } catch {
            threw = true;
        }
        server.close();
        assert.strictEqual(threw, true, 'central operators did not reject malformed payload');
    });

    it('create posts operator draft and maps response to domain record', async function() {
        const uid = `create-${Math.random().toString(36).slice(2)}`.toUpperCase();
        const server = http.createServer((req, res) => {
            let raw = '';
            req.on('data', (chunk) => {
                raw += chunk;
            });
            req.on('end', () => {
                const draft = JSON.parse(raw);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    id: 15,
                    cardUid: draft.cardUid,
                    firstName: draft.firstName,
                    lastName: draft.lastName,
                    displayName: draft.displayName
                }));
            });
        });
        await new Promise((resolve) => {
            server.listen(0, resolve);
        });
        const { port } = server.address();
        const client = stateHttpClient({ baseUrl: `http://127.0.0.1:${port}` });
        const source = centralOperators(client, '/api/v1');
        const row = await source.create({
            cardUid: uid,
            firstName: 'Виктор',
            lastName: 'Павлов',
            displayName: 'Виктор Павлов'
        });
        server.close();
        assert.strictEqual(row.cardUid, uid, 'central operators did not map created card uid');
    });

    it('enabled reads registration flag from central', async function() {
        const server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ enabled: true }));
        });
        await new Promise((resolve) => {
            server.listen(0, resolve);
        });
        const { port } = server.address();
        const client = stateHttpClient({ baseUrl: `http://127.0.0.1:${port}` });
        const source = centralOperators(client, '/api/v1');
        const flag = await source.enabled();
        server.close();
        assert.strictEqual(flag, true, 'central operators did not read registration flag');
    });
});
