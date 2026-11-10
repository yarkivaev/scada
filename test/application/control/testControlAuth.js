import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import controlClient, { clientFromEnv } from '../../../src/application/control/controlClient.js';
describe('control gateway token authentication', () => {
    it('authenticates and refreshes a rejected cached token without exposing credentials', async () => {
        let authentications = 0;
        const headers = [];
        const server = createServer(async (request, response) => {
            const chunks = [];
            for await (const chunk of request) { chunks.push(chunk); }
            const input = JSON.parse(Buffer.concat(chunks).toString());
            if (request.url === '/v3/auth/authenticate') {
                assert.equal(input.name, 'agent'); assert.equal(input.password, 'test-only');
                authentications += 1;
                response.end(JSON.stringify({ token: `token-${authentications}` }));
            } else {
                headers.push(request.headers.authorization);
                if (request.headers.authorization === 'token-1') { response.writeHead(401); response.end(JSON.stringify({ code: 16, error: 'invalid auth token' })); }
                else { response.end(JSON.stringify({ kvs: [] })); }
            }
        });
        await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
        try {
            const client = clientFromEnv({ CONTROL_ENDPOINTS: `http://127.0.0.1:${server.address().port}`, CONTROL_USERNAME: 'agent', CONTROL_PASSWORD: 'test-only' });
            await client('/v3/kv/range', { key: 'YQ==' });
            await client('/v3/kv/range', { key: 'YQ==' });
            assert.equal(authentications, 2);
            assert.deepEqual(headers, ['token-1', 'token-2', 'token-2']);
        } finally { await new Promise((resolve) => { server.close(resolve); }); }
    });
    it('does not expose malformed authentication responses through error messages', async () => {
        const server = createServer((request, response) => { response.end('secret-token-invalid-json'); });
        await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
        try {
            const client = controlClient({ endpoints: [`http://127.0.0.1:${server.address().port}`], username: 'agent', password: 'test-only' });
            await assert.rejects(client('/v3/kv/range', {}), (error) => {
                assert.equal(error.message.includes('secret'), false);
                return true;
            });
        } finally { await new Promise((resolve) => { server.close(resolve); }); }
    });
    it('requires a complete credential pair' , () => {
        assert.throws(() => { controlClient({ endpoints: ['http://localhost'], username: 'agent' }); }, /credentials/u);
    });
});
