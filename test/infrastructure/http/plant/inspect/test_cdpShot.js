import assert from 'assert';
import http from 'node:http';
import cdpGateway from '../../../../../src/infrastructure/http/plant/inspect/cdpGateway.js';

function reply(socket, json) {
    const payload = Buffer.from(JSON.stringify(json), 'utf8');
    socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
}

describe('cdpGateway shot', function() {
    it('captures a png through a loopback host websocket', async function() {
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        const server = http.createServer();
        server.on('upgrade', (req, socket) => {
            socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
            socket.on('data', () => {
                reply(socket, { id: 1, result: { data: png.toString('base64') } });
            });
        });
        await new Promise((resolve) => {
            server.listen(0, '127.0.0.1', resolve);
        });
        const { port } = server.address();
        let shot;
        try {
            shot = await cdpGateway(async () => {
                return {
                    status: 200,
                    headers: {},
                    body: Buffer.from(JSON.stringify([{
                        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/x`
                    }]))
                };
            }).shot({ host: '127.0.0.1', port });
        } finally {
            server.close();
        }
        assert.strictEqual(Buffer.compare(shot, png), 0, 'cdp shot did not return the captured png');
    });
});
