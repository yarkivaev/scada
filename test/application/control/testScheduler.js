import assert from 'node:assert/strict';
import schedule from '../../../src/application/control/schedule.js';
const catalog = { version: 'v1', nodes: ['a', 'b', 'c'].map((id) => { return { id, capacity: 10 }; }), tasks: [{ taskId: 's', spec: { adapter: 'test' }, copies: 2 }] };
function report(id, at, tasks = []) { return { nodeId: id, receivedAt: at, tasks }; }
describe('control placement', () => {
    it('covers tasks on distinct physical nodes and pins serial', () => {
        const input = { ...catalog, tasks: [...catalog.tasks, { taskId: 'serial', spec: { adapter: 'serial' }, pinnedNode: 'a' }] };
        const result = schedule(input, ['a', 'b', 'c'].map((id) => { return report(id, 1000); }), {}, { now: 1000 });
        assert.equal(Object.values(result).flatMap((r) => { return r.assignments; }).filter((r) => { return r.taskId === 's'; }).length, 2);
        assert.equal(result.a.assignments.some((r) => { return r.taskId === 'serial'; }), true);
        assert.equal(result.b.assignments.some((r) => { return r.taskId === 'serial'; }), false);
    });
    it('keeps assignments stable when capacity and catalog do not change', () => {
        const reports = ['a', 'b', 'c'].map((id) => { return report(id, 1000); });
        const first = schedule(catalog, reports, {}, { now: 1000 });
        assert.deepEqual(schedule(catalog, reports, first, { now: 1000 }), first);
    });
    it('waits 30 seconds with a surviving reader, then replaces without revoking isolated node', () => {
        const current = { a: { generation: 1, assignments: [{ taskId: 's', generation: 1, specVersion: 1, spec: { adapter: 'test' } }] }, b: { generation: 1, assignments: [{ taskId: 's', generation: 1, specVersion: 1, spec: { adapter: 'test' } }] } };
        const reports = [report('a', 0), report('b', 20000, [{ taskId: 's', state: 'running', lastRead: 20000 }]), report('c', 20000)];
        const before = schedule(catalog, reports, current, { now: 20000, freshnessMs: 10000 });
        assert.equal(before.c.assignments.length, 0);
        const after = schedule(catalog, [report('a', 0), report('b', 31000, [{ taskId: 's', state: 'running', lastRead: 20000 }]), report('c', 31000)], current, { now: 31000, freshnessMs: 10000 });
        assert.equal(after.c.assignments.length, 1);
        assert.equal(after.a.assignments.length, 1);
    });
    it('replaces immediately when no active reader is confirmed', () => {
        const result = schedule(catalog, [report('c', 1000)], {}, { now: 1000 });
        assert.equal(result.c.assignments.length, 1);
    });
    it('reserves first coverage before allocating second copies', () => {
        const input = { ...catalog, nodes: [{ id: 'a', capacity: 1 }, { id: 'b', capacity: 1 }], tasks: [...catalog.tasks, { taskId: 't', spec: { adapter: 'test' }, copies: 2 }] };
        const result = schedule(input, [report('a', 1000), report('b', 1000)], {}, { now: 1000 });
        assert.deepEqual(Object.values(result).flatMap((r) => { return r.assignments.map((task) => { return task.taskId; }); }).sort(), ['s', 't']);
    });
});
describe('placement recovery', () => {
    it('removes excess only after two remaining copies confirm reads', () => {
        const current = Object.fromEntries(['a', 'b', 'c'].map((id) => { return [id, { generation: 1, assignments: [{ taskId: 's', generation: 1, specVersion: 1, spec: { adapter: 'test' } }] }]; }));
        const reports = ['a', 'b', 'c'].map((id) => { return report(id, 1000, [{ taskId: 's', state: 'running', lastRead: 1000 }]); });
        const result = schedule(catalog, reports, current, { now: 1000 });
        assert.equal(Object.values(result).flatMap((row) => { return row.assignments; }).length, 2);
    });
});
describe('placement versions and source progress', () => {
    it('publishes changed catalog version even for unchanged task spec', () => {
        const reports = ['a', 'b', 'c'].map((id) => { return report(id, 1000); });
        const first = schedule(catalog, reports, {}, { now: 1000 });
        const next = schedule({ ...catalog, version: 'v2' }, reports, first, { now: 1000 });
        assert.equal(next.a.catalogVersion, 'v2');
        assert.ok(next.a.generation > first.a.generation);
    });
    it('starts replacement when executors are reachable but assigned readers failed', () => {
        const current = Object.fromEntries(['a', 'b'].map((id) => { return [id, { generation: 1, assignments: [{ taskId: 's', generation: 1, assignedAt: 0, specVersion: 1, spec: { adapter: 'test' } }] }]; }));
        const result = schedule(catalog, [report('a', 40000, [{ taskId: 's', state: 'failed' }]), report('b', 40000, [{ taskId: 's', state: 'failed' }]), report('c', 40000)], current, { now: 40000 });
        assert.equal(result.c.assignments.length, 1);
    });
});
describe('rolling source configuration', () => {
    it('changes only one replica until its new configuration confirms reads', () => {
        const current = Object.fromEntries(['a', 'b'].map((id) => { return [id, { generation: 1, catalogVersion: 'v1', assignments: [{ taskId: 's', generation: 1, assignedAt: 0, specVersion: 1, spec: { adapter: 'test' } }] }]; }));
        const reports = ['a', 'b', 'c'].map((id) => { return report(id, 1000, [{ taskId: 's', generation: 1, state: 'running', lastRead: 1000 }]); });
        const next = schedule({ ...catalog, version: 'v2', tasks: [{ ...catalog.tasks[0], spec: { adapter: 'test', value: 2 } }] }, reports, current, { now: 1000 });
        const changed = Object.values(next).flatMap((row) => { return row.assignments; }).filter((row) => { return row.spec.value === 2; });
        assert.equal(changed.length, 1);
        assert.equal(next.b.catalogVersion, 'v1');
    });
});
describe('node retirement', () => {
    it('sends an explicit empty snapshot when a connected executor leaves the catalog', () => {
        const current = { a: { generation: 5, catalogVersion: 'v1', assignments: [{ taskId: 's', generation: 5, specVersion: 1, spec: { adapter: 'test' } }] } };
        const result = schedule({ version: 'v2', nodes: [], tasks: [] }, [report('a', 1000)], current, { now: 1000 });
        assert.equal(result.a.assignments.length, 0);
        assert.ok(result.a.generation > 5);
    });
});
