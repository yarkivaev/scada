import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bindModules } from '../../src/application/deploy/releaseValues.js';
const chart = fileURLToPath(new URL('../../charts/scada', import.meta.url));
function render(values) {
    return execFileSync('helm', ['template', 'edge', chart, '-f', '-'], {
        encoding: 'utf8', input: JSON.stringify({ image: 'example.invalid/api:1', sink: { enabled: false }, rabbitmq: { enabled: false }, ...values })
    });
}
describe('deployment parity', () => {
    it('passes state-store chart settings with authoritative enabled state and secret', () => {
        assert.deepEqual(bindModules({ modules: { state_store: { enabled: false, chart: { existingClaim: 'old-data', data: '/data/pg', enabled: true, secret: 'ignored' } } } }, 'credentials'), {
            postgres: { existingClaim: 'old-data', data: '/data/pg', enabled: false, secret: 'credentials' }
        });
    });
    it('routes Postgres to preserved pods whose database port has no name', () => {
        const manifest = render({ site: { enabled: false }, postgres: { podTemplate: {
            metadata: { labels: { app: 'postgres' } }, spec: { containers: [{ name: 'postgres', image: 'postgres:16', ports: [{ containerPort: 5432 }] }] }
        } } });
        assert.match(manifest, /port: 5432\n {6}targetPort: 5432/u);
        assert(!manifest.includes('targetPort: postgres'));
    });
    it('mounts existing Postgres data and config without creating storage', () => {
        const manifest = render({ postgres: {
            existingClaim: 'old-data', storage: '50Gi', storageClass: 'local-path', data: '/var/lib/postgresql/data/existing',
            command: ['bash'], args: ['/config/start.sh'], env: { POSTGRES_USER: { valueFrom: { secretKeyRef: { name: 'auth', key: 'username' } } }, MODE: 'scram' },
            envFrom: [{ secretRef: { name: 'extra-auth' } }],
            volumeMounts: [{ name: 'config', mountPath: '/config', readOnly: true }], volumes: [{ name: 'config', configMap: { name: 'pg-config' } }],
            readinessProbe: { exec: { command: ['pg_isready'] } }, livenessProbe: { tcpSocket: { port: 5432 } }, resources: { requests: { memory: '256Mi' } }
        } });
        assert(manifest.includes('claimName: old-data'));
        assert(!manifest.includes('volumeClaimTemplates:'));
        assert(!manifest.includes('kind: PersistentVolumeClaim'));
        for (const text of ['value: "/var/lib/postgresql/data/existing"', 'command: ["bash"]', 'args: ["/config/start.sh"]', 'mountPath: /config', 'name: pg-config', 'name: extra-auth', 'key: username', 'value: "scram"', 'pg_isready', 'tcpSocket:', 'memory: 256Mi']) {
            assert(manifest.includes(text), `missing ${text}`);
        }
        assert.equal((manifest.match(/name: POSTGRES_USER/gu) || []).length, 1);
        assert(manifest.includes('      app: postgres\n  template:'));
    });
    it('injects process references and envFrom while preserving literal env', () => {
        const manifest = render({ site: { enabled: false }, postgres: { enabled: false }, processes: [{ name: 'reader', command: ['read'],
            env: { ENABLED: false, INTERVAL: 5, URL: { valueFrom: { secretKeyRef: { name: 'reader-auth', key: 'url' } } } }, envFrom: [{ configMapRef: { name: 'reader-env' } }]
        }] });
        for (const text of ['value: "false"', 'value: "5"', 'secretKeyRef:', 'name: reader-auth', 'key: url', 'envFrom:', 'name: reader-env']) { assert(manifest.includes(text), `missing ${text}`); }
    });
    it('injects site references and retains configured public and internal ports', () => {
        const manifest = render({ postgres: { enabled: false }, env: [{ name: 'CHECKPOINT_URL', valueFrom: { secretKeyRef: { name: 'api-auth', key: 'url' } } }],
            envFrom: [{ secretRef: { name: 'api-env' } }], service: { port: 3000, internalPort: 8081, nodePort: 30300 } });
        for (const text of ['secretKeyRef:', 'name: api-auth', 'name: api-env', 'containerPort: 3000', 'containerPort: 8081', 'nodePort: 30300']) { assert(manifest.includes(text), `missing ${text}`); }
    });
});

describe('generic application chart extensions', () => {
    it('renders process ports, custom probes and config volumes beside host devices', () => {
        const manifest = render({ site: { enabled: false }, postgres: { enabled: false }, processes: [{ name: 'api', command: ['serve'], args: ['--api'],
            ports: [{ name: 'http', containerPort: 3000 }], hostDevices: ['/dev/ttyS1'],
            readinessProbe: { httpGet: { path: '/ready', port: 'http' } }, livenessProbe: { tcpSocket: { port: 'http' } },
            volumeMounts: [{ name: 'config', mountPath: '/config' }], volumes: [{ name: 'config', configMap: { name: 'api-config' } }]
        }] });
        for (const text of ['args: ["--api"]', 'containerPort: 3000', 'path: /ready', 'tcpSocket:', 'mountPath: /config', 'name: api-config', 'type: CharDevice', 'type: Recreate']) { assert(manifest.includes(text), `missing ${text}`); }
        assert.equal((manifest.match(/volumeMounts:/gu) || []).length, 1);
        assert.equal((manifest.match(/^ {6}volumes:/gmu) || []).length, 1);
    });
    it('renders extra Kubernetes objects without evaluating template strings', () => {
        const manifest = render({ site: { enabled: false }, postgres: { enabled: false }, extraObjects: [{ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'api-config' }, data: { script: '{{ literal }}' } }] });
        assert(manifest.includes('kind: ConfigMap'));
        assert(manifest.includes('{{ literal }}'));
    });
    it('references the existing broker claim without managing it and preserves pod annotations', () => {
        const manifest = render({ postgres: { enabled: false }, rabbitmq: { enabled: true, claimName: 'broker-data', createClaim: false, podAnnotations: { 'setup/revision': 'previous' } } });
        assert(manifest.includes('claimName: broker-data'));
        assert(!manifest.includes('kind: PersistentVolumeClaim'));
        assert(!manifest.includes('volumeClaimTemplates:'));
        assert(manifest.includes('setup/revision: previous'));
    });
});

describe('chart upgrade compatibility', () => {
    it('retains the original Postgres default env order to avoid unnecessary pod drift', () => {
        const manifest = render({ site: { enabled: false } });
        assert.deepEqual([...manifest.matchAll(/- name: (?<name>POSTGRES_DB|POSTGRES_USER|POSTGRES_PASSWORD|PGDATA)/gu)].map((match) => { return match.groups.name; }),
            ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'PGDATA']);
    });
    it('allows custom probes to override health defaults without duplicate YAML keys', () => {
        const manifest = render({ site: { enabled: false }, postgres: { enabled: false }, processes: [{ name: 'reader', command: ['read'], health: { port: 9090 },
            readinessProbe: { exec: { command: ['ready'] } }, livenessProbe: { exec: { command: ['live'] } } }] });
        assert.equal((manifest.match(/readinessProbe:/gu) || []).length, 1);
        assert.equal((manifest.match(/livenessProbe:/gu) || []).length, 1);
        assert(manifest.includes('- ready') && manifest.includes('- live'));
    });
});


describe('Postgres private image credentials', () => {
    it('uses the root pullSecret on the Postgres pod', () => {
        const manifest = render({ site: { enabled: false }, pullSecret: 'existing-registry' });
        assert.match(manifest, /imagePullSecrets:\n {8}- name: existing-registry/u);
    });
});
