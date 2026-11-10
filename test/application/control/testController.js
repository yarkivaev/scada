import assert from 'node:assert/strict';
import { reconcile } from '../../../src/application/control/controller.js';
import { createServer } from 'node:http';
import controlClient from '../../../src/application/control/controlClient.js';
describe('quorum controller', () => {
    it('never writes assignments without a leadership token', async () => {
        let reads = 0;
        const store = { acquire() { return null; }, read() { reads += 1; } };
        assert.equal(await reconcile(store, 'c'), false);
        assert.equal(reads, 0);
    });
    it('passes the election token and catalog revisions to fenced commit', async () => {
        let commit;
        const view = { catalog: { version: 'v1', nodes: [{ id: 'a', capacity: 1 }], tasks: [{ taskId: 's', spec: { adapter: 'test' } }] }, reports: [{ nodeId: 'a', receivedAt: 1000 }], assignments: {}, revisions: { catalog: '3' } };
        const store = { acquire() { return 'token'; }, read() { return view; }, commit(...args) { commit = args; return true; } };
        assert.equal(await reconcile(store, 'c', { now: 1000 }), true);
        assert.equal(commit[0], 'token');
        assert.deepEqual(commit[1], view);
        assert.equal(commit[2].a.assignments.length, 1);
    });
    it('bounds gateway failures and fails over endpoints', async () => {
        const server = createServer((req, res) => { res.end(JSON.stringify({ header: { revision: '1' }, kvs: [] })); });
        await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
        try {
            const client = controlClient({ endpoints: ['http://127.0.0.1:1', `http://127.0.0.1:${server.address().port}`], timeoutMs: 100 });
            assert.deepEqual((await client('/v3/kv/range', { key: 'YQ==' })).kvs, []);
        } finally { await new Promise((resolve) => { server.close(resolve); }); }
    });
});
