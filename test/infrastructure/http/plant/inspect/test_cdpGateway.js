import assert from 'assert';
import http from 'node:http';
import cdpGateway, { cdpRequest, rewriteDebugger } from '../../../../../src/infrastructure/http/plant/inspect/cdpGateway.js';

describe('cdpGateway', function() {
    it('sends loopback Host for the debug port', function() {
        assert.strictEqual(
            cdpRequest({ host: '192.0.2.10', port: 9222 }, '/json/list').headers.Host,
            '127.0.0.1:9222',
            'upstream Host was not loopback'
        );
    });

    it('rewrites debugger websocket urls onto the inspect prefix', function() {
        const body = JSON.stringify({
            webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/x'
        });
        assert.strictEqual(
            JSON.parse(rewriteDebugger(body, 'example.test:443', 'm1')).webSocketDebuggerUrl,
            'wss://example.test/infra/inspect/m1/devtools/page/x',
            'debugger url was not rewritten onto the inspect prefix'
        );
    });

    it('fetches debugger json through a fake http endpoint', async function() {
        const server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/x' }));
        });
        await new Promise((resolve) => {
            server.listen(0, '127.0.0.1', resolve);
        });
        const { port } = server.address();
        const payload = JSON.parse(await cdpGateway().json(
            { host: '127.0.0.1', port },
            '/json/list',
            'example.test:443',
            'm1'
        ));
        server.close();
        assert.strictEqual(
            payload.webSocketDebuggerUrl,
            'wss://example.test/infra/inspect/m1/devtools/page/x',
            'gateway did not rewrite the fake chrome json'
        );
    });
});
