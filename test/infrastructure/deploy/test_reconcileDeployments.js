import assert from 'node:assert/strict';
import deploymentPatch from '../../../src/infrastructure/deploy/deploymentPatch.js';
import reconcileDeployments from '../../../src/infrastructure/deploy/reconcileDeployments.js';

function deployment(resourceVersion, replicas, env) {
    return {
        metadata: { resourceVersion },
        spec: { replicas, template: { spec: { containers: [env ? { env } : {}] } } }
    };
}

describe('deployment reconciliation', function () {
    it('guards each update with its observed resource version and retries conflicts', async function () {
        const target = '/apis/apps/v1/namespaces/operators/deployments/worker';
        const patches = [];
        const bodies = [deployment('20', 1), deployment('21', 1), deployment('22', 2)];
        const exchange = (verb, path, body, format) => {
            assert.equal(path, target);
            if (verb === 'GET') { return { status: 200, body: JSON.stringify(bodies.shift()) }; }
            assert.equal(format, 'application/json-patch+json');
            patches.push(body);
            return { status: patches.length === 1 ? 409 : 200 };
        };
        const api = reconcileDeployments({ namespace: 'operators', exchange });
        await api.apply({ name: 'worker', replicas: 2 }, deploymentPatch);
        assert.deepEqual(patches, ['20', '21'].map((version) => {
            return [
                { op: 'test', path: '/metadata/resourceVersion', value: version },
                { op: 'replace', path: '/spec/replicas', value: 2 }
            ];
        }));
    });

    it('creates the env array when the container has no environment yet', function () {
        assert.deepEqual(deploymentPatch(deployment('1', 1), { environment: { WORK_MODE: 'idle' } }), {
            op: 'add',
            path: '/spec/template/spec/containers/0/env',
            value: [{ name: 'WORK_MODE', value: 'idle' }]
        });
    });
});
