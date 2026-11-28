import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import verifyCollectorCoverage from '../../../src/infrastructure/deploy/verifyCollectorCoverage.js';

const spec = { adapter: 'modbus', url: 'mqtt://unused' };
const specHash = createHash('sha256').update(JSON.stringify(spec)).digest('hex');
function fixture() {
    const now = 100000;
    const task = { taskId: 'input', spec, eligibleNodes: ['old', 'spare'] };
    const evidence = { coverage: [{ taskId: 'input', nodeId: 'spare', workload: 'deployment/maintenance-bridge' }] };
    const status = { initialized: true, tasks: [{ taskId: 'input', specHash, state: 'running', health: 'healthy', lastRead: now }] };
    const calls = [];
    const options = { cluster: 'old', namespace: 'workshop-runtime', tasks: [task], workloads: ['deployment/maintenance-bridge'], evidence, now: () => {return now},
        execute(program, args) {
            calls.push({ program, args });
            if (args.includes('nodes')) {
                const node = args[args.indexOf('--context') + 1];
                return JSON.stringify({ items: [{ metadata: { uid: node }, status: { addresses: [{ type: 'InternalIP', address: node }] } }] });
            }
            return JSON.stringify(status);
        } };
    return { options, status, calls, evidence };
}
describe('live surviving reader cutover gate', function() {
    it('refuses catalog-only historical evidence with no live spare', function() {
        const { options } = fixture(); options.evidence = { controlCatalogVersion: 'published' };
        assert.throws(() => { verifyCollectorCoverage(options); }, /coverage/u);
    });
    it('requires a freshly read matching source on a separate physical node', function() {
        const { options, calls } = fixture();
        verifyCollectorCoverage(options);
        assert(calls.some(({ args }) => { return args.includes('exec') && args.includes('deployment/maintenance-bridge'); }));
    });
    it('rejects stale reads, wrong source configuration, failed and uninitialized readers', function() {
        for (const change of [(status) => { status.tasks[0].lastRead = 1; },
            (status) => { status.tasks[0].lastRead = 200000; },
            (status) => { status.tasks[0].specHash = 'old-source'; },
            (status) => { status.tasks[0].health = 'degraded'; },
            (status) => { status.tasks[0].state = 'failed'; },
            (status) => { status.initialized = false; }]) {
            const { options, status } = fixture(); change(status);
            assert.throws(() => { verifyCollectorCoverage(options); }, /reader/u);
        }
    });
    it('rejects self, ineligible node and a second context pointing at the same node', function() {
        for (const nodeId of ['old', 'unknown']) {
            const { options, evidence } = fixture(); evidence.coverage[0].nodeId = nodeId;
            assert.throws(() => { verifyCollectorCoverage(options); }, /coverage/u);
        }
        const { options } = fixture();
        options.execute = () => { return JSON.stringify({ items: [{ metadata: { uid: 'same' }, status: { addresses: [] } }] }); };
        assert.throws(() => { verifyCollectorCoverage(options); }, /physical/u);
    });
    it('fails closed on network loss and rechecks rather than caching evidence', function() {
        const { options, status } = fixture(); verifyCollectorCoverage(options);
        status.tasks[0].lastRead = 1;
        assert.throws(() => { verifyCollectorCoverage(options); }, /reader/u);
        options.execute = () => { throw new Error('network lost'); };
        assert.throws(() => { verifyCollectorCoverage(options); }, /network lost/u);
    });
});
