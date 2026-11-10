import assert from 'node:assert/strict';
import schedule from '../../../src/application/control/schedule.js';

const now = 100000;
const old = { taskId: 'sensor', generation: 1, assignedAt: 0, specVersion: 1, spec: { adapter: 'test', value: 1 } };
const catalog = { version: 'v2', nodes: ['a', 'b', 'c'].map(id => { return { id, capacity: 10 }; }),
    tasks: [{ taskId: 'sensor', copies: 2, spec: { adapter: 'test', value: 2 } }] };
const current = Object.fromEntries(['a', 'b'].map(id => { return [id, { generation: 1, catalogVersion: 'v1', assignments: [old] }]; }));
const report = (id, tasks = [], receivedAt = now) => { return { nodeId: id, receivedAt, tasks }; };
const reading = (generation, lastRead = now, state = 'running') => { return { taskId: 'sensor', generation, state, lastRead }; };

describe('configuration changes preserve potentially working coverage', function() {
    for (const tasks of [[], [reading(1, now - 20000)], [reading(0, now, 'failed')]]) {
        it(`retains the only potentially working owner with ${JSON.stringify(tasks)}`, function() {
            const result = schedule(catalog, [report('a', tasks), report('b', [], 0)], current, { now });
            assert.deepEqual(result.a.assignments[0], old);
        });
    }
    it('starts a spare without restarting a quiet owner until that spare demonstrates its assigned generation', function() {
        const first = schedule(catalog, [report('a', [reading(1, now - 20000)]), report('b', [], 0), report('c')], current, { now });
        assert.deepEqual(first.a.assignments[0], old);
        assert.equal(first.c.assignments[0].spec.value, 2);
        const confirmed = schedule(catalog, [report('a', [reading(1, now - 20000)]), report('b', [], 0),
            report('c', [reading(first.c.assignments[0].generation)])], first, { now });
        assert.equal(confirmed.a.assignments[0].spec.value, 2);
    });
    for (const health of ['degraded', 'failed']) {
        it(`does not use recent read evidence from ${health} required-channel health`, function() {
            const reports = ['a', 'b'].map(id => {return report(id, [{ ...reading(1), health }])});
            const result = schedule(catalog, [...reports, report('c')], current, { now });
            assert.equal(result.c.assignments.length, 1);
            assert.deepEqual(result.a.assignments[0], old);
        });
    }
    it('may update a current-generation explicitly failed owner when no other reader has progressed', function() {
        const result = schedule(catalog, [report('a', [reading(1, undefined, 'failed')]), report('b', [], 0)], current, { now });
        assert.equal(result.a.assignments[0].spec.value, 2);
    });
    it('may repair an explicitly failed old owner while a new spare remains unconfirmed', function() {
        const state = { ...current, 'c': { generation: 1, catalogVersion: 'v2', assignments: [
            { ...old, spec: catalog.tasks[0].spec, assignedAt: now }
        ] } };
        const result = schedule(catalog, [report('a', [reading(1, undefined, 'failed')]), report('b', [], 0), report('c')], state, { now });
        assert.equal(result.a.assignments[0].spec.value, 2);
    });
});
