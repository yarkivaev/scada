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
});
