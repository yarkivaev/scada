import assert from 'node:assert/strict';
import executeKubeSeed from '../../../src/infrastructure/deploy/executeKubeSeed.js';

const plan = {
    source: { context: 'archive', namespace: 'workshop' },
    destination: { context: 'active', namespace: 'workshop', nodeAddress: '192.0.2.25' },
    allowedPods: ['storage-0'],
    transfers: [{ name: 'samples', read: ['archive-0', '--', 'export'], write: ['storage-0', '--', 'import'] }]
};

function fixture(appearance) {
    const calls = [];
    const bytes = Buffer.from([0xff, 0x00, 0x2c]);
    let checks = 0;
    function execute(_program, args, options) {
        calls.push({ args, options });
        if (args.includes('nodes')) {
            return '{"items":[{"status":{"addresses":[{"type":"InternalIP","address":"192.0.2.25"}]}}]}';
        }
        if (args.includes('pods')) {
            checks += 1;
            return JSON.stringify({ items: checks === appearance ? [{ metadata: { name: 'writer' }, status: { phase: 'Running' } }] : [] });
        }
        if (args.includes('export')) { return bytes; }
        return '';
    }
    return { calls, bytes, execute };
}

describe('bounded Kubernetes seed', () => {
    it('rechecks the destination when a writer started during the export', () => {
        const { execute, calls } = fixture(2);
        assert.throws(() => { executeKubeSeed(plan, execute); }, /writers/u);
        assert(calls.some(({ args }) => { return args.includes('export'); }));
        assert(calls.every(({ args }) => { return !args.includes('import'); }));
    });

    it('pipes unchanged bytes to the verified destination with a bounded export', () => {
        const { execute, calls, bytes } = fixture();
        assert.deepEqual(executeKubeSeed(plan, execute), ['samples']);
        const exported = calls.find(({ args }) => { return args.includes('export'); });
        const imported = calls.find(({ args }) => { return args.includes('import'); });
        assert.deepEqual(exported.args.slice(0, 2), ['--context', 'archive']);
        assert.equal(exported.options.encoding, null);
        assert.equal(exported.options.maxBuffer, 64 * 1024 * 1024);
        assert.deepEqual(imported.args.slice(0, 2), ['--context', 'active']);
        assert.equal(imported.options.input, bytes);
    });
});
