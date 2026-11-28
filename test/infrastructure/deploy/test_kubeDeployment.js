import assert from 'node:assert/strict';
import applyWhenChanged from '../../../src/infrastructure/deploy/applyWhenChanged.js';
import { deploymentKube, verifyKubeNode } from '../../../src/infrastructure/deploy/deploymentKube.js';

describe('Kubernetes deployment helpers', () => {
    it('preserves the namespace and context when checking a node identity', () => {
        const kube = deploymentKube({ context: 'workshop-west', namespace: 'controller' }, (command, args) => {
            assert.equal(command, 'kubectl');
            assert.deepEqual(args, ['--context', 'workshop-west', '--namespace', 'controller', 'get', 'nodes', '-o', 'json']);
            return '{"items":[{"metadata":{"name":"workshop"},"status":{"addresses":[{"type":"InternalIP","address":"192.0.2.5"}]}}]}';
        });
        assert.equal(verifyKubeNode(kube, '192.0.2.5').metadata.name, 'workshop');
        assert.throws(() => { verifyKubeNode(kube, '192.0.2.6'); }, /identity/u);
        assert.throws(() => { verifyKubeNode(kube, '192.0.2.5', 'different-node'); }, /identity/u);
    });

    it('never applies when diff cannot establish whether resources changed', () => {
        const calls = [];
        const execute = applyWhenChanged((command, args) => {
            calls.push([command, args]);
            throw Object.assign(new Error('server unavailable'), { status: 2 });
        });
        assert.throws(() => { execute('kubectl', ['apply', '-f', '-']); }, /server unavailable/u);
        assert.deepEqual(calls, [['kubectl', ['diff', '-f', '-']]]);
    });
});
