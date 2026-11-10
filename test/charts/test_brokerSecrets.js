import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const chart = fileURLToPath(new URL('../../charts/scada', import.meta.url));
function render(extra = {}) {
    const values = { image: 'fixture.invalid/runtime:tested', role: 'edge',
        postgres: { enabled: false }, clickhouse: { enabled: false },
        rabbitmq: { enabled: true, definitionsSecret: 'broker-definitions', runtimeSecret: 'broker-runtime',
            definitions: { users: [{ name: 'fixture', password: 'sensitive-fixture' }] },
            extraConfig: { 'mqtt.allow_anonymous': 'false' } }, ...extra };
    return yaml.loadAll(execFileSync('helm', ['template', 'fixture', chart, '-f', '-'], {
        encoding: 'utf8', input: JSON.stringify(values), stdio: ['pipe', 'pipe', 'pipe']
    })).filter(Boolean);
}
function workload(documents, name) {
    return documents.find(document => { return document.metadata.name === name && ['Deployment', 'StatefulSet'].includes(document.kind); });
}

describe('broker credential boundaries in rendered workloads', () => {
    it('keeps definitions out of ConfigMaps and mounts only the referenced Secret', () => {
        const documents = render();
        for (const document of documents.filter(value => { return value.kind === 'ConfigMap'; })) {
            assert.equal(Object.hasOwn(document.data || {}, 'definitions.json'), false);
            assert.equal(JSON.stringify(document).includes('sensitive-fixture'), false);
        }
        const pod = workload(documents, 'fixture-rabbitmq').spec.template.spec;
        const mount = pod.containers[0].volumeMounts.find(value => { return value.mountPath === '/etc/rabbitmq/definitions.json'; });
        assert.equal(pod.volumes.find(value => { return value.name === mount.name; }).secret.secretName, 'broker-definitions');
        const config = documents.find(document => { return document.data?.['rabbitmq.conf']; }).data['rabbitmq.conf'];
        assert.equal(config.match(/mqtt.allow_anonymous = false/gu)?.length, 1);
    });
    it('wires each AMQP/STOMP credential once through Secret references for site and sink', () => {
        const documents = render();
        for (const name of ['fixture-site-server', 'fixture-supervisor-sink']) {
            const env = workload(documents, name).spec.template.spec.containers[0].env;
            assert.equal(new Set(env.map(value => { return value.name; })).size, env.length);
            for (const key of ['AMQP_URL', 'STOMP_LOGIN', 'STOMP_PASSCODE']) {
                const field = env.find(value => { return value.name === key; });
                assert.deepEqual(field.valueFrom.secretKeyRef, { name: 'broker-runtime', key });
                assert.equal(Object.hasOwn(field, 'value'), false);
            }
        }
    });
    it('preserves an explicit sink Secret reference rather than stringifying it', () => {
        const reference = { secretKeyRef: { name: 'sink-credentials', key: 'token' } };
        const documents = render({ env: [{ name: 'STATE_HTTP_TOKEN', valueFrom: reference }] });
        const env = workload(documents, 'fixture-supervisor-sink').spec.template.spec.containers[0].env;
        assert.deepEqual(env.find(value => { return value.name === 'STATE_HTTP_TOKEN'; }).valueFrom, reference);
    });
    it('refuses a frozen broker template that would silently keep the old definitions mount', () => {
        assert.throws(() => { render({ rabbitmq: { enabled: true, definitionsSecret: 'broker-definitions', podTemplate: { spec: {} } } }); },
            /unfreeze storage templates/u);
    });
});
