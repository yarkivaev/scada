import assert from 'node:assert/strict';
import createRuntime from '../../../src/application/runtime/runtime.js';

function fixture(options = {}) {
    const events = [];
    const registry = new Map([['test', {
        validate(spec) { if (!spec.resource) { throw new Error('missing resource'); } },
        resources(spec) { return [spec.resource]; },
        create(spec, context) {
            return { start() { events.push(`start:${spec.resource}`); },
                stop() { assert.equal(context.signal.aborted, true); events.push(`stop:${spec.resource}`); },
                status() { return { state: 'running' }; } };
        }
    }]]);
    return { events, runtime: createRuntime({ registry, ...options }) };
}
function assignment(taskId, generation = 1, resource = taskId) {
    return { taskId, generation, specVersion: 1, spec: { adapter: 'test', resource } };
}

describe('universal runtime assignments', () => {
    it('repeats apply idempotently and stops old generation before replacement', async () => {
        const { runtime, events } = fixture();
        await runtime.apply(assignment('one'));
        await runtime.apply(assignment('one'));
        await runtime.apply(assignment('one', 2, 'new'));
        assert.deepEqual(events, ['start:one', 'stop:one', 'start:new']);
        await runtime.stop();
    });
    it('does not resurrect removed generations, including previously unknown tasks', async () => {
        const { runtime, events } = fixture();
        await runtime.remove({ taskId: 'one', generation: 3 });
        await assert.rejects(runtime.apply(assignment('one', 3)), /stale/u);
        await assert.rejects(runtime.apply(assignment('one', 2)), /stale/u);
        await runtime.apply(assignment('one', 4));
        await runtime.remove({ taskId: 'one', generation: 2 });
        assert.deepEqual(events, ['start:one']);
        await runtime.stop();
    });
    it('rejects conflicting specs at the same generation without stopping the live task', async () => {
        const { runtime, events } = fixture();
        await runtime.apply(assignment('one'));
        await assert.rejects(runtime.apply(assignment('one', 1, 'other')), /conflict/u);
        assert.deepEqual(events, ['start:one']);
        await runtime.stop();
    });
    it('rejects duplicate physical resources before starting another task', async () => {
        const { runtime, events } = fixture();
        await runtime.apply(assignment('one', 1, 'ttyS4'));
        await assert.rejects(runtime.apply(assignment('two', 1, 'ttyS4')), /claimed/u);
        assert.deepEqual(events, ['start:ttyS4']);
        await runtime.stop();
    });
    it('rejects invalid config before stopping a healthy generation', async () => {
        const { runtime, events } = fixture();
        await runtime.apply(assignment('one'));
        await assert.rejects(runtime.apply(assignment('one', 2, '')), /missing resource/u);
        assert.deepEqual(events, ['start:one']);
        await runtime.stop();
    });
    it('serializes simultaneous applies for one task without affecting another', async () => {
        const { runtime, events } = fixture();
        await Promise.all([runtime.apply(assignment('one')), runtime.apply(assignment('one')), runtime.apply(assignment('two'))]);
        assert.equal(events.filter(event => { return event === 'start:one'; }).length, 1);
        assert.equal(runtime.status().tasks.length, 2);
        await runtime.stop();
    });
    it('bounds tombstones and rejects invalid generations', async () => {
        const { runtime } = fixture({ maxTasks: 1 });
        await runtime.remove({ taskId: 'one', generation: 1 });
        await assert.rejects(runtime.remove({ taskId: 'two', generation: 1 }), /capacity/u);
        await assert.rejects(runtime.apply(assignment('one', -1)), /generation/u);
        await runtime.stop();
    });
    it('quarantines resources after stuck cleanup and reports fatal instead of starting a duplicate', async () => {
        const registry = new Map([['test', { validate() {}, resources() { return ['port']; }, create() {
            return { start() {}, stop() { return new Promise(() => {}); } };
        } }]]);
        const runtime = createRuntime({ registry, stopTimeoutMs: 5 });
        await runtime.apply(assignment('one'));
        await assert.rejects(runtime.apply(assignment('one', 2)), /timed out/u);
        assert.equal(runtime.status().fatal, true);
        await assert.rejects(runtime.apply(assignment('two')), /fatal/u);
        await assert.rejects(runtime.stop(), /timed out/u);
    });
});

describe('runtime admission races', () => {
    it('validates budget limits before stopping a healthy generation', async () => {
        const { runtime, events } = fixture();
        await runtime.apply(assignment('one'));
        const next = assignment('one', 2);
        next.spec.limits = { maxBytes: -1 };
        await assert.rejects(runtime.apply(next), /maxBytes/u);
        assert.deepEqual(events, ['start:one']);
        await runtime.stop();
    });
    it('does not start resources if shutdown happened while validation was pending', async () => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        let starts = 0;
        const registry = new Map([['test', { validate() { return gate; }, resources() { return []; }, create() {
            return { start() { starts += 1; }, stop() {} };
        } }]]);
        const runtime = createRuntime({ registry });
        const applying = runtime.apply(assignment('one'));
        await new Promise(resolve => { setImmediate(resolve); });
        const stopped = runtime.stop();
        release();
        await assert.rejects(applying, /stopping/u);
        await stopped;
        assert.equal(starts, 0);
    });
});

it('makes an explicitly fatal asynchronous transport event sticky until executor replacement', async () => {
    let report;
    const registry = new Map([['test', { validate() {}, resources() { return []; }, create(_spec, ctx) {
        report = ctx.report;return { start() {}, stop() {} };
    } }]]);
    const runtime = createRuntime({ registry });
    await runtime.apply({ taskId: 'one', specVersion: 1, generation: 1, spec: { adapter: 'test' } });
    report({ state: 'failed', fatal: true, reason: 'uncertain STOMP write' });
    assert.equal(runtime.status().fatal, true);
    report({ state: 'running' });
    assert.equal(runtime.status().fatal, true);
    await assert.rejects(runtime.apply({ taskId: 'two', specVersion: 1, generation: 1, spec: { adapter: 'test' } }), /fatal/u);
    await runtime.stop();
});
