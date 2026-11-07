import assert from 'node:assert/strict';
import executeStages from '../../../src/infrastructure/deploy/executeStages.js';
function stages() {
    return ['api', 'collector'].map((name) => { return { context: 'lab', namespace: 'edge', release: name, chart: 'chart',
        fieldManager: 'edge', values: { name }, workloads: [`deployment/${name}`],
        ...(name === 'collector' ? { podsAbsentBeforeApply: ['app=api,pod-template-hash=old'] } : {}) }; });
}
function runner(calls, pods = '') {
    return (command, args) => {
        const call = `${command} ${args.join(' ')}`;
        calls.push(call);
        if (command === 'helm') { return args[1]; }
        if (args.includes('pods')) { return pods; }
        return '';
    };
}
describe('executeStages', () => {
    it('validates legacy adoption before writes and checks SSA only after that stage hands off its fields', () => {
        const calls = []; const adopted = new Set(); const run = runner(calls);
        function ownership(command, args, options) {
            const result = run(command, args);
            if (args.includes('apply')) {
                if (args.includes('--server-side') && !adopted.has(options.input)) { throw new Error('legacy ownership conflict'); }
                if (!args.includes('--server-side') && !args.includes('--dry-run=server')) { adopted.add(options.input); }
            }
            assert(!args.includes('--force-conflicts'));
            return result;
        }
        assert.doesNotThrow(() => {return executeStages(stages(), 'adopt', ownership)});
        const firstWrite = calls.findIndex((call) => {return call.includes(' apply ') && !call.includes('dry-run')});
        assert.equal(calls.slice(0, firstWrite).filter((call) => {return call.includes('--dry-run=server')}).length, 3);
        assert.deepEqual([...adopted], ['api', 'collector']);
    });
    it('does not write any stage if a later legacy-adoption validation fails', () => {
        const calls = []; const run = runner(calls);
        assert.throws(() => {return executeStages(stages(), 'adopt', (command, args, options) => {
            if (options?.input === 'collector' && args.includes('--dry-run=server')) { throw new Error('admission failed'); }
            return run(command, args);
        })}, /admission failed/u);
        assert(!calls.some((call) => {return call.includes(' apply ') && !call.includes('dry-run')}));
    });
    it('preflights every stage before writes and waits for the API before starting the collector', () => {
        const calls = [];
        executeStages(stages(), 'apply', runner(calls));
        const writes = calls.flatMap((call, index) => { return call.includes(' apply ') && !call.includes('dry-run') ? [index] : []; });
        assert.equal(writes.length, 2);
        assert.equal(calls.slice(0, writes[0]).filter((call) => { return call.includes('--dry-run=server'); }).length, 3);
        const apiReady = calls.findIndex((call) => { return call.includes('rollout status deployment/api'); });
        const absent = calls.findIndex((call) => { return call.includes('get pods -l app=api,pod-template-hash=old -o name'); });
        assert(apiReady < absent && absent < writes[1]);
    });
    it('never starts the collector if old API reader pods remain', () => {
        const calls = [];
        assert.throws(() => { executeStages(stages(), 'apply', runner(calls, 'pod/api-old')); }, /pods remain/u);
        assert(!calls.some((call) => { return call.includes('rollout status deployment/collector'); }));
        assert.equal(calls.filter((call) => { return call.includes(' apply ') && !call.includes('dry-run'); }).length, 1);
    });
    it('does not mutate any stage when a later preflight fails', () => {
        const calls = [];
        const run = runner(calls);
        assert.throws(() => { executeStages(stages(), 'apply', (command, args, options) => {
            if (options?.input === 'collector' && args.includes('--dry-run=server')) { throw new Error('conflict'); }
            return run(command, args, options);
        }); }, /conflict/u);
        assert(!calls.some((call) => { return call.includes(' apply ') && !call.includes('dry-run'); }));
    });
    it('keeps render and check free of pod gates and writes', () => {
        for (const action of ['render', 'check', 'diff', 'check-adoption']) {
            const calls = [];
            executeStages(stages(), action, runner(calls));
            assert(!calls.some((call) => { return call.includes('get pods') || (call.includes(' apply ') && !call.includes('dry-run')); }));
        }
    });
});

describe('staged live gates', () => {
    it('blocks a collector when the caller-owned live API gate fails', () => {
        const calls = [];
        const plans = stages();
        plans[1].beforeApply = (plan, kube) => {
            assert.equal(plan.release, 'collector');
            kube(['get', 'deployment/api', '-o', 'json'], undefined, true);
            throw new Error('embedded readers enabled');
        };
        assert.throws(() => { executeStages(plans, 'apply', runner(calls)); }, /embedded readers/u);
        assert.equal(calls.filter((call) => { return call.includes(' apply ') && !call.includes('dry-run'); }).length, 1);
    });
    it('stops before later stages after a failed API rollout', () => {
        const calls = [];
        const run = runner(calls);
        assert.throws(() => { executeStages(stages(), 'apply', (command, args, options) => {
            if (args.includes('rollout')) { throw new Error('rollout incomplete'); }
            return run(command, args, options);
        }); }, /rollout incomplete/u);
        assert.equal(calls.filter((call) => { return call.includes(' apply ') && !call.includes('dry-run'); }).length, 1);
    });
    it('rejects broad pod selectors before any stage mutation', () => {
        for (const selector of ['', 'app!=api', 'app', 'app in (api,reader)']) {
            const plans = stages();
            plans[1].podsAbsentBeforeApply = [selector];
            const calls = [];
            assert.throws(() => { executeStages(plans, 'apply', runner(calls)); }, /exact equality/u);
            assert(!calls.some((call) => { return call.includes(' apply ') && !call.includes('dry-run'); }));
        }
    });
});
