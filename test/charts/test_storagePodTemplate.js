import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const chart = fileURLToPath(new URL('../../charts/scada', import.meta.url));
function render(storage, settings) {
    const output = execFileSync('helm', ['template', 'edge', chart, '-f', '-'], {
        encoding: 'utf8', input: JSON.stringify({ site: { enabled: false }, sink: { enabled: false },
            postgres: { enabled: false }, rabbitmq: { enabled: false }, [storage]: { enabled: true, ...settings } })
    });
    // The parser rejects duplicate mapping keys, including template/spec collisions.
    return yaml.loadAll(output).filter(Boolean);
}
function statefulset(documents) {
    return documents.find((document) => { return document.kind === 'StatefulSet'; });
}
for (const storage of ['postgres', 'rabbitmq']) {
    describe(`${storage} preserved storage pod template`, () => {
        const claim = storage === 'postgres' ? { existingClaim: 'existing-data' } : { claimName: 'existing-data', createClaim: false };
        const podTemplate = { metadata: { labels: { app: storage }, annotations: { 'setup/revision': 'original', literal: '{{ untouched }}' } },
            spec: { restartPolicy: 'Always', terminationGracePeriodSeconds: 60,
                containers: [{ name: storage, image: 'example.invalid/preserved:original', env: [{ name: 'MODE', value: 'existing-layout' }],
                    command: ['/existing-entrypoint'], volumeMounts: [{ name: 'existing', mountPath: '/existing/data' }] }],
                volumes: [{ name: 'existing', persistentVolumeClaim: { claimName: 'existing-data' } }] } };
        it('renders the exact supplied PodTemplateSpec without generated labels, env, mounts or checksums', () => {
            const documents = render(storage, { ...claim, podTemplate, image: 'example.invalid/ignored:new', rolloutOnConfigChange: true,
                podAnnotations: { ignored: 'new' }, env: { IGNORED: 'new' } });
            const workload = statefulset(documents);
            assert.deepEqual(workload.spec.template, podTemplate);
            assert.deepEqual(workload.spec.selector.matchLabels, { app: storage });
            assert.equal(workload.spec.volumeClaimTemplates, undefined);
            assert.equal(documents.some((document) => { return document.kind === 'PersistentVolumeClaim'; }), false);
        });
        it('treats an empty override as absent and retains normal default containers and storage', () => {
            const original = render(storage, {});
            assert.deepEqual(render(storage, { podTemplate: {} }), original);
            const workload = statefulset(original);
            assert.equal(workload.spec.template.spec.containers[0].name, storage);
            assert.equal(workload.spec.volumeClaimTemplates[0].metadata.name, 'data');
        });
        if (storage === 'rabbitmq') {
            it('retains requested standalone PVC ownership outside an overridden broker template', () => {
                const documents = render(storage, { claimName: 'managed-data', createClaim: true, storage: '2Gi', podTemplate });
                assert.deepEqual(statefulset(documents).spec.template, podTemplate);
                const pvc = documents.find((document) => { return document.kind === 'PersistentVolumeClaim'; });
                assert.equal(pvc.metadata.name, 'managed-data');
                assert.equal(pvc.spec.resources.requests.storage, '2Gi');
            });
        }
        it('rejects non-object overrides through chart schema validation', () => {
            for (const value of [[], 'not-a-template', false]) {
                assert.throws(() => { render(storage, { podTemplate: value }); }, /podTemplate/u);
            }
        });
    });
}
