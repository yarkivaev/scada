import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { collectorDeployment, deploymentContext, peerNodePort, retiredDeployments, stageFor } from '../../src/application/deploy/deploymentPlan.js';
import { collectorControlDeployment, etcdMembership, versionedControlCatalog } from '../../src/application/deploy/controlPlan.js';

const document = {
    profiles: {
        local: {
            apps: { scada: { image: 'example.invalid/scada:1' } },
            variables: { cluster: 'west' }
        }
    },
    servers: [{ id: 'worker', profile: { id: 'local' }, api: [{ id: 'status', url: 'http://worker.invalid' }] }]
};

describe('deployment plan composition', () => {
    it('pairs the selected server and its profile with the validated release values', () => {
        const context = deploymentContext(document, 'west');
        assert.strictEqual(context.server.id, 'worker');
        assert.strictEqual(context.profile.apps.scada.image, 'example.invalid/scada:1');
        assert.strictEqual(context.scada.image, 'example.invalid/scada:1');
        assert.throws(() => { deploymentContext(document, 'missing'); }, /no server for cluster/u);
    });

    it('uses one collector with sorted unique serial devices and the declared assignments', () => {
        const assignments = [{ taskId: 'probe', spec: { adapter: 'fixture' } }];
        const collectors = collectorDeployment([{ hostDevices: ['/dev/b', '/dev/a'] }, { hostDevices: ['/dev/a'] }], {
            assignments,
            command: ['scada-collector'],
            image: 'example.invalid/collector:1',
            environment: { AMQP_URL: 'amqp://broker.invalid' },
            hostSecurity: { fsGroup: 22 }
        });
        assert.deepStrictEqual(collectors[0].hostDevices, ['/dev/a', '/dev/b']);
        assert.deepStrictEqual(collectors[0].podSecurityContext, { fsGroup: 22 });
        assert.deepStrictEqual(collectors[0].command, ['scada-collector']);
        assert.deepStrictEqual(JSON.parse(collectors[0].env.COLLECTOR_MANIFEST), { assignments });
        assert.strictEqual(collectors[0].env.AMQP_URL, 'amqp://broker.invalid');
        assert.deepStrictEqual(collectorDeployment([], { image: 'example.invalid/collector:1' }), []);
    });

    it('guards declared predecessor names and prevents retiring a desired or repeated deployment', () => {
        assert.deepStrictEqual(retiredDeployments({ prefix: 'unit', groups: [['old']], desired: [{ name: 'new' }] }), [
            { workload: 'deployment/unit-old', selector: 'app=old' }
        ]);
        assert.throws(() => { retiredDeployments({ prefix: 'unit', groups: [['new']], desired: [{ name: 'new' }] }); }, /invalid replacement/u);
        assert.throws(() => { retiredDeployments({ prefix: 'unit', groups: [['old'], ['old']] }); }, /invalid replacement/u);
        assert.throws(() => { retiredDeployments({ prefix: 'unit', groups: [['../old']] }); }, /invalid replacement/u);
    });

    it('binds node-port ingress to explicit peers and keeps internal listener rules separate', () => {
        const spec = {
            name: 'mesh', namespace: 'cell', selector: { app: 'broker' }, peerAddresses: ['192.0.2.5'],
            portName: 'wire', port: 5672, nodePort: 32560, additionalPorts: [5673], namespacePeers: [{}]
        };
        const [service, policy] = peerNodePort(spec);
        assert.deepStrictEqual(service.spec, {
            type: 'NodePort', externalTrafficPolicy: 'Local', selector: { app: 'broker' },
            ports: [{ name: 'wire', port: 5672, targetPort: 5672, nodePort: 32560 }]
        });
        assert.deepStrictEqual(policy.spec.ingress, [
            { from: [{ namespaceSelector: {} }, { ipBlock: { cidr: '192.0.2.5/32' } }], ports: [{ protocol: 'TCP', port: 5672 }] },
            { ports: [{ protocol: 'TCP', port: 5673 }] }
        ]);
        assert.throws(() => { peerNodePort({ ...spec, peerAddresses: ['peer.invalid'] }); }, /IPv4/u);
        const closed = peerNodePort({ ...spec, peerAddresses: [], namespacePeers: [], additionalPorts: [] });
        assert.deepStrictEqual(closed[1].spec.ingress, []);
    });

    it('composes explicit stage overrides without mutating the shared defaults', () => {
        const common = { context: 'west', namespace: 'control', release: 'cell', chart: 'charts/local' };
        const values = { image: 'example.invalid/collector:1', store: { enabled: false } };
        const plan = stageFor(common, values)('api', { store: { enabled: true } }, ['deployment/api']);
        assert.deepStrictEqual(plan, {
            ...common, id: 'api', values: { ...values, store: { enabled: true } }, workloads: ['deployment/api']
        });
        assert.strictEqual(values.store.enabled, false);
    });
});

describe('control-plane plan composition', () => {
    it('uses voting nodes in declaration order for both etcd views', () => {
        assert.deepStrictEqual(etcdMembership([
            { id: 'a', address: 'one.invalid', voter: true },
            { id: 'b', address: 'two.invalid', voter: false },
            { id: 'c', address: '2001:db8::3', voter: true }
        ], { clientPort: 111, peerPort: 222 }), {
            endpoints: 'https://one.invalid:111,https://[2001:db8::3]:111',
            initialCluster: 'a=https://one.invalid:222,c=https://[2001:db8::3]:222'
        });
    });

    it('renders collector recovery, capacity, and credential settings from the selected installation', () => {
        const plan = collectorControlDeployment({
            agentImage: 'example.invalid/agent:1',
            agentStorage: '2Gi',
            authUsernameKey: 'account',
            authPasswordKey: 'password',
            prefix: '/fixture',
            recoveryTimeoutMs: 12000,
            spoolMaxBytes: 1024,
            spoolMaxRecords: 10
        }, { id: 'west', clientTlsSecret: 'west-client', agent: { spoolMaxBytes: 2048, heapMb: 64 } }, {
            endpoints: 'https://control.invalid:2379',
            hostDevices: ['/dev/fixture'],
            brokerEndpoints: { broker: 'amqp://broker.invalid' },
            deliverySecret: 'fixture-delivery'
        });
        assert.strictEqual(plan.tlsSecret, 'west-client');
        assert.strictEqual(plan.deliverySecret, 'fixture-delivery');
        assert.strictEqual(plan.storage, '2Gi');
        assert.deepStrictEqual(plan.startupProbe, {
            httpGet: { path: '/startup', port: 9092 }, periodSeconds: 5, timeoutSeconds: 2, failureThreshold: 4
        });
        assert.strictEqual(plan.env.COLLECTOR_SPOOL_MAX_BYTES, '2048');
        assert.strictEqual(plan.env.NODE_OPTIONS, '--max-old-space-size=64');
        assert.strictEqual(plan.env.COLLECTOR_CONTROL_ENDPOINTS, 'https://control.invalid:2379');
        assert.deepStrictEqual(JSON.parse(plan.env.COLLECTOR_BROKER_ENDPOINTS), { broker: 'amqp://broker.invalid' });
    });

    it('preserves the deployed catalog digest shape and rejects duplicate task identities', () => {
        const nodes = [{ id: 'west', capacity: 2, address: 'west.invalid' }];
        const tasks = [{ taskId: 'probe', spec: { adapter: 'fixture' } }];
        const content = { controlEpoch: 4, nodes: [{ id: 'west', capacity: 2 }], tasks };
        const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
        assert.deepStrictEqual(versionedControlCatalog({ version: 2, controlEpoch: 4, nodes, tasks }), {
            version: `2:${digest}`, ...content
        });
        assert.throws(() => { versionedControlCatalog({ version: 2, nodes, tasks: [...tasks, ...tasks] }); }, /Duplicate control task identity/u);
    });
});
