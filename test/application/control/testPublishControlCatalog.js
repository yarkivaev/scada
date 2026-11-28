import assert from 'node:assert';
import publishControlCatalog from '../../../src/application/control/publishControlCatalog.js';

describe('control catalog publication status', function() {
    it('does not call a disconnected previously applied agent live', async function() {
        const plan = { catalog: { version: 7, nodes: [{ id: 'a' }] } };
        const store = { async read() { return { assignments: { a: { catalogVersion: 7, generation: 3 } },
            reports: [{ nodeId: 'a', receivedAt: Date.now() - 60000, appliedGeneration: 3 }] }; } };
        const result = await publishControlCatalog(plan, store, async () => { return { accepted: true }; });
        assert.strictEqual(result.nodes[0].status, 'stale');
        assert.strictEqual(result.nodes[0].appliedGeneration, 3);
    });
    it('distinguishes accepted catalog from applied and disconnected nodes', async function() {
        const plan = { catalog: { version: 7, nodes: [{ id: 'a' }, { id: 'b' }] } };
        const store = { async read() {
            return { assignments: { a: { catalogVersion: 7, generation: 3 } }, reports: [{ nodeId: 'a', receivedAt: Date.now(), appliedGeneration: 3 }] };
        } };
        const result = await publishControlCatalog(plan, store, async (received, catalog) => {
            assert.strictEqual(received, store);
            assert.strictEqual(catalog, plan.catalog);
            return { accepted: true, revision: '42', catalogVersion: 7 };
        });
        assert.strictEqual(result.accepted, true);
        assert.deepStrictEqual(result.nodes.map((node) => { return node.status; }), ['applied', 'pending']);
    });
    it('does not report a previous catalog generation as applied', async function() {
        const plan = { catalog: { version: 8, nodes: [{ id: 'a' }] } };
        const store = { async read() { return { assignments: { a: { catalogVersion: 7, generation: 3 } }, reports: [{ nodeId: 'a', receivedAt: Date.now(), appliedGeneration: 3 }] }; } };
        const result = await publishControlCatalog(plan, store, async () => { return { accepted: true }; });
        assert.strictEqual(result.nodes[0].status, 'pending');
    });
    it('reports failed tasks even when the snapshot generation was applied', async function() {
        const plan = { catalog: { version: '8', nodes: [{ id: 'a' }] } };
        const store = { async read() { return { assignments: { a: { catalogVersion: '8', generation: 3 } },
            reports: [{ nodeId: 'a', receivedAt: Date.now(), appliedGeneration: 3, tasks: [{ taskId: 'input', state: 'failed' }] }] }; } };
        const result = await publishControlCatalog(plan, store, async () => { return { accepted: true }; });
        assert.strictEqual(result.nodes[0].status, 'error');
        assert.deepStrictEqual(result.nodes[0].errors, [{ taskId: 'input', state: 'failed' }]);
    });

    it('does not confuse matching generations from a previous recovery epoch with application', async function() {
        const plan = { catalog: { version: '8', controlEpoch: 'restored', nodes: [{ id: 'a' }] } };
        const report = { nodeId: 'a', controlEpoch: 'initial', receivedAt: Date.now(), appliedGeneration: 1 };
        const assignment = { catalogVersion: '8', controlEpoch: 'restored', generation: 1 };
        const store = { async read() { return { assignments: { a: assignment }, reports: [report] }; } };
        const publish = async () => { return { accepted: true }; };
        assert.strictEqual((await publishControlCatalog(plan, store, publish)).nodes[0].status, 'pending');
        report.controlEpoch = 'restored';
        assert.strictEqual((await publishControlCatalog(plan, store, publish)).nodes[0].status, 'applied');
    });

    it('shows partial application errors while healthy assignments continue', async function() {
        const plan = { catalog: { version: '8', nodes: [{ id: 'a' }] } };
        const store = { async read() { return { assignments: { a: { catalogVersion: '8', generation: 3 } },
            reports: [{ nodeId: 'a', receivedAt: Date.now(), receivedGeneration: 3, appliedGeneration: null,
                tasks: [{ taskId: 'unavailable', state: 'failed' }, { taskId: 'healthy', state: 'running' }] }] }; } };
        const result = await publishControlCatalog(plan, store, async () => { return { accepted: true }; });
        assert.strictEqual(result.nodes[0].status, 'error');
        assert.deepStrictEqual(result.nodes[0].errors, [{ taskId: 'unavailable', state: 'failed' }]);
    });

});
