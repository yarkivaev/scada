import assert from 'node:assert/strict';
import applyHelmResources from '../../../src/infrastructure/deploy/applyHelmResources.js';
import requestFromWorkload from '../../../src/infrastructure/deploy/requestFromWorkload.js';
import bootstrapKubeStorage from '../../../src/infrastructure/deploy/bootstrapKubeStorage.js';
import verifyRuntimeCapabilities from '../../../src/infrastructure/deploy/verifyRuntimeCapabilities.js';
import executeChartDeployment from '../../../src/infrastructure/deploy/executeChartDeployment.js';
import executeStagedDeployment from '../../../src/infrastructure/deploy/executeStagedDeployment.js';
import { requireWorkloadEnvironment, verifyPostgresReadiness } from '../../../src/infrastructure/deploy/deploymentChecks.js';

function stage(id) {
    return { id, chart: 'charts/service', release: id, namespace: 'fixture', context: 'fixture', fieldManager: 'fixture', values: {} };
}

function commandLog(log) {
    return (program, args, options) => {
        log.push([program, args, options]);
        if (program === 'helm' && args[0] === 'template') { return 'manifest'; }
        return '';
    };
}

describe('deployment profile execution', () => {
    it('renders only selected stages without inspecting live infrastructure', () => {
        const calls = [];
        const manifest = executeStagedDeployment({
            action: 'render',
            plan: { stages: [stage('store'), stage('viewer')] },
            omitStages: ['viewer'],
            preflight() { throw new Error('live preflight must not run'); }
        }, commandLog(calls));
        assert.equal(manifest, 'manifest');
        assert.deepEqual(calls.map(([program, args]) => {return [program, args[0], args[1]]}), [['helm', 'template', 'store']]);
    });

    it('checks mutation evidence before accessing protected settings', () => {
        assert.throws(() => {return executeStagedDeployment({
            action: 'apply',
            plan: { stages: [stage('store')] },
            validateMutation() { throw new Error('stale authorization'); },
            prepare() { throw new Error('protected settings must not be read'); }
        }, commandLog([]))}, /stale authorization/u);
    });

    it('builds chart dependencies before offline rendering and skips live checks', () => {
        const calls = [];
        const manifest = executeChartDeployment({
            action: 'render',
            plan: stage('worker'),
            chartRoot: '/fixture',
            preflight() { throw new Error('live preflight must not run'); },
            transformManifests: (output) => {return output.toUpperCase()}
        }, commandLog(calls));
        assert.equal(manifest, 'manifest');
        assert.deepEqual(calls.map(([program, args]) => {return [program, args[0], args[2]]}), [
            ['helm', 'dependency', '--skip-refresh'], ['helm', 'template', '/fixture/charts/service']
        ]);
    });

    it('rejects old live pods even when the workload has the expected environment', () => {
        function kube(args) {
            return args.includes('pods') ? JSON.stringify({ items: [{ spec: { containers: [{ name: 'gateway', env: [] }] } }] }) : 'external';
        }
        assert.throws(() => {return requireWorkloadEnvironment(kube, {
            workload: 'deployment/gateway', selector: 'app=gateway', container: 'gateway', key: 'MODE', value: 'external'
        })}, /Pod environment/u);
    });

    it('checks the configured fallback when the service workload has not been deployed', () => {
        const calls = [];
        verifyPostgresReadiness((args) => { calls.push(args); return ''; }, {
            workload: 'deployment/gateway', fallback: { target: 'store-0', user: 'fixture', database: 'metrics' }
        });
        assert.deepEqual(calls, [
            ['get', 'deployment/gateway', '--ignore-not-found', '-o', 'name'],
            ['exec', 'store-0', '--', 'pg_isready', '-U', 'fixture', '-d', 'metrics']
        ]);
    });
    it('rejects partial durable storage without rendering or applying a replacement', () => {
        const calls = [];
        function execute(program, args) {
            calls.push(program);
            return args.includes('statefulset/store-a') ? '{"kind":"StatefulSet"}' : '';
        }
        assert.throws(() => {
            bootstrapKubeStorage({ context: 'fixture', namespace: 'fixture', stage: stage('store'),
                storage: ['statefulset/store-a', 'statefulset/store-b'] }, 'apply', execute);
        }, /Partial storage/u);
        assert.deepEqual(calls, ['kubectl', 'kubectl']);
    });

    it('requires selected isolated runtime images to negotiate the same protocol', () => {
        const calls = [];
        function execute(program, args) {
            calls.push([program, args]);
            const role = args.at(-1);
            return JSON.stringify({ role, historyProtocols: ['history', role === 'producer' ? 'replica-v2' : 'replica-v1'] });
        }
        assert.throws(() => {
            verifyRuntimeCapabilities({ candidates: ['producer', 'consumer'].map((role) => {
                return { role, image: 'fixture:immutable', entrypoint: 'node', args: [role] };
            }), required: ['history'], match: { roles: ['producer', 'consumer'], preference: ['replica-v2', 'replica-v1'] } }, execute);
        }, /same protocol/u);
        assert(calls.every(([program, args]) => { return program === 'docker' && args.includes('--network=none') && args.includes('--read-only'); }));
    });

    it('applies only declared platform resource kinds to the selected context', () => {
        const calls = [];
        const documents = [{ kind: 'Role' }, { kind: 'Deployment' }, null, { kind: 'Service' }];
        applyHelmResources(stage('store'), { kinds: ['Role', 'Service'], decode() { return documents; },
            encode(resource) { return JSON.stringify(resource); } }, commandLog(calls));
        assert.equal(calls.length, 2);
        assert.deepEqual(calls[1][1], ['--context', 'fixture', '--namespace', 'fixture', 'apply', '--server-side',
            '--field-manager=fixture', '-f', '-']);
        assert.equal(calls[1][2].input, '{"kind":"Role"}---\n{"kind":"Service"}');
    });

    it('fences workload requests to loopback before executing a remote command', () => {
        assert.throws(() => {
            requestFromWorkload(() => { throw new Error('untrusted endpoint reached execution'); }, { url: 'https://outside.example' });
        }, /loopback/u);
    });

});
