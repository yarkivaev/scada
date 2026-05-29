import assert from 'assert';
import http from 'http';
import stateHttpClient from '../../../../src/infrastructure/http/edge/stateHttpClient.js';

describe('stateHttpClient', function() {
    it('getJson returns parsed body on success', async function() {
        const payload = { items: [{ x: 1 }] };
        const server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(payload));
        });
        await new Promise((resolve) => {
            server.listen(0, resolve);
        });
        const { port } = server.address();
        const client = stateHttpClient({ baseUrl: `http://127.0.0.1:${port}` });
        const data = await client.getJson('/v1/ping', { a: 'b' });
        server.close();
        assert.deepStrictEqual(data, payload, 'client did not parse JSON response');
    });

    it('getJson throws on non-2xx response', async function() {
        const server = http.createServer((req, res) => {
            res.writeHead(503, { 'Content-Type': 'text/plain' });
            res.end('busy');
        });
        await new Promise((resolve) => {
            server.listen(0, resolve);
        });
        const { port } = server.address();
        const client = stateHttpClient({ baseUrl: `http://127.0.0.1:${port}` });
        let threw = false;
        try {
            await client.getJson('/v1/missing', {});
        } catch {
            threw = true;
        }
        server.close();
        assert.strictEqual(threw, true, 'client did not throw on error status');
    });
});
