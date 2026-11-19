import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import runtimeHealth from '../../../src/application/runtime/runtimeHealth.js';
import spoolSurface from '../../../src/application/runtime/spoolSurface.js';

async function freePort() {
    const server = createServer();
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const { port } = server.address();
    await new Promise((resolve) => { server.close(resolve); });
    return port;
}

describe('collector health checkpoint', function() {
    it('serves pending-segments on the health port', async function() {
        const port = await freePort();
        const health = await runtimeHealth({ status() { return { initialized: true, fatal: false, stopping: false, tasks: [] }; } }, {
            port, host: '127.0.0.1', handle: spoolSurface({ peek() { return []; } }, null)
        });
        try {
            const response = await fetch(`http://127.0.0.1:${health.port}/v1/checkpoint/pending-segments`);
            const body = await response.json();
            assert.deepEqual({ status: response.status, items: body.items }, { status: 200, items: [] }, 'collector checkpoint path stayed 404');
        } finally { await health.stop(); }
    });
});
