import { execFile as run } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(run);
const adapter = new URL('../../../src/infrastructure/management/kubernetes.js', import.meta.url).href;
const ready = {
    kind: 'Deployment',
    metadata: { name: 'prod-site-server', generation: 2 },
    status: { observedGeneration: 2, availableReplicas: 1, updatedReplicas: 1 }
};

async function observe(test, kubectl) {
    const root = await mkdtemp(join(tmpdir(), 'scada-explicit-workloads-'));
    try {
        await writeFile(join(root, 'kubectl'), `#!/usr/bin/env node\n${kubectl}\n`, { mode: 0o755 });
        await execFile(process.execPath, ['--input-type=module', '-e', `
            import assert from 'node:assert/strict';
            import kubernetes from ${JSON.stringify(adapter)};
            const target = (workloads) => kubernetes({ kubeContext: 'central', namespace: 'scada-prod-apps', workloads });
            ${test}
        `], { env: { ...process.env, PATH: `${root}${delimiter}${process.env.PATH}` } });
    } finally {
        await rm(root, { force: true, recursive: true });
    }
}

describe('Kubernetes explicit workloads', function () {
    this.timeout(10000);
    it('uses scoped exact refs and preserves a missing workload as failed', async () => {
        await observe(`
            assert.deepEqual(await target(['deployment/prod-site-server', 'statefulset/prod-postgres']).components(), [
                { id: 'deployment/prod-site-server', state: 'ready' },
                { id: 'statefulset/prod-postgres', state: 'failed' }
            ]);
        `, `
            const assert = require('node:assert/strict');
            assert.deepEqual(process.argv.slice(2), ['get', '--context=central', '--namespace=scada-prod-apps',
                'deployment/prod-site-server', 'statefulset/prod-postgres', '--ignore-not-found', '-o', 'json']);
            process.stdout.write(JSON.stringify({ kind: 'List', items: [${JSON.stringify(ready)}] }));
        `);
    });

    it('supports one unlabelled workload and restricts log reads to its ref', async () => {
        await observe(`
            const configured = target(['deployment/prod-site-server']);
            assert.deepEqual(await configured.components(), [{ id: 'deployment/prod-site-server', state: 'ready' }]);
            await assert.rejects(configured.logs('deployment/other', 20), /unknown component/);
            assert.equal(await configured.logs('deployment/prod-site-server', 20), 'site server log');
        `, `
            const assert = require('node:assert/strict');
            const [action, ...args] = process.argv.slice(2);
            if (action === 'get') {
                assert.deepEqual(args, ['--context=central', '--namespace=scada-prod-apps',
                    'deployment/prod-site-server', '--ignore-not-found', '-o', 'json']);
                process.stdout.write(JSON.stringify(${JSON.stringify(ready)}));
            } else {
                assert.deepEqual([action, ...args], ['logs', '--context=central', '--namespace=scada-prod-apps',
                    'deployment/prod-site-server', '--tail=20', '--all-containers=true']);
                process.stdout.write('site server log');
            }
        `);
    });

    it('handles an empty successful response when the only configured ref is missing', async () => {
        await observe(`
            const configured = target(['deployment/prod-site-server']);
            assert.deepEqual(await configured.components(), [{ id: 'deployment/prod-site-server', state: 'failed' }]);
            await assert.rejects(configured.logs('deployment/prod-site-server', 20), /unknown component/);
        `, `
            const assert = require('node:assert/strict');
            assert.deepEqual(process.argv.slice(2), ['get', '--context=central', '--namespace=scada-prod-apps',
                'deployment/prod-site-server', '--ignore-not-found', '-o', 'json']);
        `);
    });
});
