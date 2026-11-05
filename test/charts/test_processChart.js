import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const chart = fileURLToPath(new URL('../../charts/scada', import.meta.url));

function render(values) {
    return execFileSync('helm', ['template', 'demo', chart, '-f', '-'], {
        timeout: 30000, encoding: 'utf8', input: JSON.stringify({ image: 'example.invalid/app:1', ...values })
    });
}

describe('named processes in the scada chart', function() {
    this.timeout(35000);

    it('can run a single named reader without site services or a database', function() {
        const manifest = render({
            site: { enabled: false }, sink: { enabled: false }, postgres: { enabled: false },
            rabbitmq: { enabled: false }, prefix: 'station', workloadLabels: { zone: 'east' },
            processes: [{ name: 'reader', command: ['read'], env: { INTERVAL: 5 }, hostDevices: ['/dev/ttyS2'] }]
        });
        assert.equal((manifest.match(/^kind: /gmu) || []).length, 1);
        assert.ok(manifest.includes('name: station-reader'));
        assert.ok(manifest.includes('      app: reader\n  template:'));
        assert.ok(manifest.includes('zone: east'));
        assert.ok(manifest.includes('type: Recreate'));
        assert.ok(manifest.includes('value: "5"'));
        assert.ok(manifest.includes('type: CharDevice'));
    });

    it('renders HTTP probes only for processes that opt into health', function() {
        const manifest = render({ prefix: 'station', site: { enabled: false }, sink: { enabled: false }, postgres: { enabled: false }, rabbitmq: { enabled: false },
            processes: [{ name: 'collector', command: ['collect'], health: { port: 9091, periodSeconds: 7 } }, { name: 'legacy', command: ['legacy'] }] });
        const documents = manifest.split('---');
        const collector = documents.find((item) => { return item.includes('name: station-collector'); });
        const legacy = documents.find((item) => { return item.includes('name: station-legacy'); });
        assert(collector.includes('livenessProbe:'));
        assert(collector.includes('readinessProbe:'));
        assert(collector.includes('path: "/live"'));
        assert(collector.includes('path: "/ready"'));
        assert(collector.includes('containerPort: 9091'));
        assert(collector.includes('periodSeconds: 7'));
        assert(!legacy.includes('livenessProbe:'));
        assert(!legacy.includes('readinessProbe:'));
        assert(!manifest.includes('kind: Service'));
    });

    it('rejects invalid HTTP health ports and timeouts', function() {
        [ { port: 0 }, { port: 65536 }, { port: 9091, timeoutSeconds: 0 } ].forEach((health) => {
            assert.throws(() => { render({ processes: [{ name: 'collector', command: ['collect'], health }] }); }, /health/u);
        });
    });

    it('can use a named broker PVC, MQTT node port, configuration and explicit definitions', function() {
        const manifest = render({ rabbitmq: {
            claimName: 'persisted-queue', configName: 'broker-settings', plugins: ['rabbitmq_management'],
            extraConfig: { heartbeat: 40 }, definitions: { vhosts: [{ name: 'test' }] },
            service: { type: 'NodePort', nodePorts: { mqtt: 30123 } }
        } });
        assert.ok(manifest.includes('claimName: persisted-queue'));
        assert.ok(manifest.includes('kind: PersistentVolumeClaim\nmetadata:\n  name: persisted-queue'));
        assert.ok(manifest.includes('name: broker-settings'));
        assert.ok(manifest.includes('nodePort: 30123'));
        assert.ok(manifest.includes('heartbeat = 40'));
        assert.ok(manifest.includes('[rabbitmq_management].'));
        assert.ok(manifest.includes('"name": "test"'));
        assert.ok(!manifest.includes('scada.segments.ingest'));
    });

    it('rejects two named readers that claim the same physical device', function() {
        const processes = ['left', 'right'].map((name) => {
            return { name, command: [name], hostDevices: ['/dev/ttyS1'] };
        });
        assert.throws(() => { render({ processes }); }, /both claim \/dev\/ttyS1/u);
    });
});

it('cannot overlap a site that requests a single-writer rollout', function() {
    const manifest=render({prefix:'single',site:{enabled:true,recreate:true},sink:{enabled:false},postgres:{enabled:false},rabbitmq:{enabled:false}});
    assert.match(manifest,/strategy:\n {4}type: Recreate\n {4}rollingUpdate: null/u,'Site rollout still allows concurrent writers');
});
