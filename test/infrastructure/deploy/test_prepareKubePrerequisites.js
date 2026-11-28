import assert from 'node:assert/strict';
import prepareKubePrerequisites from '../../../src/infrastructure/deploy/prepareKubePrerequisites.js';

const source = { name: 'access', namespace: 'workshop', keys: ['token'] };
const target = { ...source, namespace: 'display', copyFrom: source };
const plan = {
    context: 'machine-room',
    nodeAddress: '192.0.2.22',
    enabled: true,
    namespaces: [source.namespace, target.namespace],
    credentials: [source, target],
    objects() { return []; }
};
const secrets = [{ kind: 'Secret', metadata: { name: source.name, namespace: source.namespace }, stringData: { token: 'fixture' } }];

function fixture(found = {}) {
    const writes = [];
    function execute(_program, args, options) {
        const namespace = args[args.indexOf('--namespace') + 1];
        if (args.includes('nodes')) {
            return '{"items":[{"status":{"addresses":[{"type":"InternalIP","address":"192.0.2.22"}]}}]}';
        }
        if (args.includes('get')) {
            const resource = args[args.indexOf('get') + 1];
            return JSON.stringify(resource.startsWith('namespace/') ? {} : found[namespace] ?? null);
        }
        assert(args.includes('create'));
        const object = JSON.parse(options.input);
        found[namespace] = object;
        writes.push(object);
        return '';
    }
    return { execute, writes };
}

describe('Kubernetes create-only prerequisites', () => {
    it('copies credentials only into a missing Secret at the declared destination', () => {
        const { execute, writes } = fixture();
        assert.deepEqual(prepareKubePrerequisites(plan, 'apply', { execute, secrets }).created, ['Secret/access', 'Secret/access']);
        assert.deepEqual(writes.map(({ metadata, data }) => { return [metadata.namespace, data.token]; }),
            [['workshop', 'Zml4dHVyZQ=='], ['display', 'Zml4dHVyZQ==']]);
        assert.deepEqual(prepareKubePrerequisites(plan, 'apply', { execute, secrets }).created, []);
    });

    it('rejects a supplied conflict before creating any prerequisites', () => {
        const { execute, writes } = fixture({ workshop: { data: { token: 'b3RoZXI=' } } });
        assert.throws(() => { prepareKubePrerequisites(plan, 'apply', { execute, secrets }); }, /Secret differs/u);
        assert.equal(writes.length, 0);
    });
});
