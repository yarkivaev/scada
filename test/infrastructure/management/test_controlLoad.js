import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import controlLoad from '../../../src/infrastructure/management/controlLoad.js';

describe('quorum controller load observations', () => {
    it('reads actual placement from the control store without requesting any writes', async () => {
        const requests = [];
        const kvs = Object.entries({
            catalog: { version: '1', nodes: [{ id: 'local', capacity: 12 }, { id: 'remote', capacity: 6 }],
                tasks: [{ taskId: 'meter', cost: 3 }] },
            'assignments/local': { assignments: [{ taskId: 'meter', spec: { password: 'private' } }] },
            'assignments/remote': { assignments: [] }
        }).map(([key, value]) => {
            return { key: Buffer.from(`/test/${key}`).toString('base64'),
                value: Buffer.from(JSON.stringify(value)).toString('base64') };
        });
        const server = createServer((req, res) => {
            requests.push(req.url);
            req.resume();
            res.end(JSON.stringify({ kvs }));
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        try {
            const { port } = server.address();
            const source = controlLoad({ site: 'edge', envPrefix: 'SCADA_TEST', keyPrefix: '/test' },
                { SCADA_TEST_ENDPOINTS: `http://127.0.0.1:${port}` });
            const metrics = await source.sample();
            assert.deepEqual(requests, ['/v3/kv/range']);
            assert.deepEqual(metrics.map(({ name, resource, value }) => { return [name, resource, value]; }), [
                ['assigned-tasks', 'local', 1], ['assigned-cost', 'local', 3], ['capacity', 'local', 12],
                ['assigned-tasks', 'remote', 0], ['assigned-cost', 'remote', 0], ['capacity', 'remote', 6]
            ]);
            assert.doesNotMatch(JSON.stringify(metrics), /private/u);
        } finally {
            server.close();
        }
    });
});
