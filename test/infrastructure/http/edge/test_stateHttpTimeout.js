import assert from 'assert';
import http from 'http';
import stateHttpClient from '../../../../src/infrastructure/http/edge/stateHttpClient.js';
import parseStateHttpTimeoutMs from '../../../../src/infrastructure/http/edge/parseStateHttpTimeoutMs.js';

describe('stateHttpClient timeout', function() {
    it('rejects when upstream does not respond before deadline', async function() {
        const server = http.createServer(() => {});
        await new Promise((resolve) => {
            server.listen(0, resolve);
        });
        const { port } = server.address();
        const client = stateHttpClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 50 });
        let code = '';
        try {
            await client.getJson('/v1/ping', {});
        } catch (err) {
            const { code: errCode } = err;
            code = errCode;
        }
        server.close();
        assert.strictEqual(code, 'TIMEOUT', 'client should surface TIMEOUT when fetch aborts');
    });
});

describe('parseStateHttpTimeoutMs', function() {
    it('uses half of REQUEST_TIMEOUT_MS when STATE_HTTP_TIMEOUT_MS is unset', function() {
        const ms = parseStateHttpTimeoutMs({ REQUEST_TIMEOUT_MS: '30000' });
        assert.strictEqual(ms, 15000, 'should derive per-hop timeout from server deadline');
    });
});
