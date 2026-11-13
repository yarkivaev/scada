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
        const reports = [report('a', 0), report('b', 20000, [{ taskId: 's', generation: 1, state: 'running', lastRead: 20000 }]), report('c', 20000)];
        const before = schedule(catalog, reports, current, { now: 20000, freshnessMs: 10000 });
        assert.equal(before.c.assignments.length, 0);
        const after = schedule(catalog, [report('a', 0), report('b', 31000, [{ taskId: 's', generation: 1, state: 'running', lastRead: 20000 }]), report('c', 31000)], current, { now: 31000, freshnessMs: 10000 });
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
        const reports = ['a', 'b', 'c'].map((id) => { return report(id, 1000, [{ taskId: 's', generation: 1, state: 'running', lastRead: 1000 }]); });
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
describe('recovery epoch read evidence', () => {
    it('does not retire redundant copies based on successful reads from an earlier control epoch', () => {
        const current = Object.fromEntries(['a', 'b', 'c'].map((id) => { return [id, { generation: 1, controlEpoch: 'new', catalogVersion: 'v1', assignments: [{ taskId: 's', generation: 1, specVersion: 1, spec: { adapter: 'test' } }] }]; }));
        const reports = ['a', 'b', 'c'].map((id) => { return { ...report(id, 1000, [{ taskId: 's', generation: 1, state: 'running', lastRead: 1000 }]), controlEpoch: 'old' }; });
        const result = schedule({ ...catalog, controlEpoch: 'new' }, reports, current, { now: 1000 });
        assert.equal(Object.values(result).flatMap((row) => { return row.assignments; }).length, 3);
    });
    it('does not advance rolling configuration on a matching-generation read from an old epoch', () => {
        const current = Object.fromEntries(['a', 'b'].map((id) => { return [id, { generation: 1, controlEpoch: 'new', catalogVersion: 'v1', assignments: [{ taskId: 's', generation: 1, specVersion: 1, spec: { adapter: 'test', value: id === 'a' ? 2 : 1 } }] }]; }));
        const reports = ['a', 'b'].map((id) => { return { ...report(id, 1000, [{ taskId: 's', generation: 1, state: 'running', lastRead: 1000 }]), controlEpoch: 'old' }; });
        const result = schedule({ ...catalog, controlEpoch: 'new', tasks: [{ ...catalog.tasks[0], spec: { adapter: 'test', value: 2 } }] }, reports, current, { now: 1000 });
        assert.equal(result.b.assignments[0].spec.value, 1);
    });
});

describe('assignment read evidence fencing', () => {
    for (const evidence of [{ generation: 0, lastRead: 40000 }, { generation: 1, lastRead: 45001 }]) {
        it(`replaces readers with stale generation or future read: ${JSON.stringify(evidence)}`, () => {
            const current = Object.fromEntries(['a', 'b'].map((id) => { return [id, { generation: 1, assignments: [{ taskId: 's', generation: 1, assignedAt: 0, specVersion: 1, spec: { adapter: 'test' } }] }]; }));
            const reports = ['a', 'b'].map((id) => { return report(id, 40000, [{ taskId: 's', state: 'running', ...evidence }]); });
            const result = schedule(catalog, [...reports, report('c', 40000)], current, { now: 40000 });
            assert.equal(result.c.assignments.length, 1);
        });
        it(`retains recovery copies until current-generation reads: ${JSON.stringify(evidence)}`, () => {
            const current = Object.fromEntries(['a', 'b', 'c'].map((id) => { return [id, { generation: 1, assignments: [{ taskId: 's', generation: 1, assignedAt: 40000, specVersion: 1, spec: { adapter: 'test' } }] }]; }));
            const reports = ['a', 'b', 'c'].map((id) => { return report(id, 40000, [{ taskId: 's', state: 'running', ...evidence }]); });
            const result = schedule(catalog, reports, current, { now: 40000 });
            assert.equal(Object.values(result).flatMap((row) => { return row.assignments; }).length, 3);
        });
    }
});

describe('bounded executor clock skew', () => {
    for (const offset of [-5000, 1, 5000]) {
        it(`keeps a reachable executor eligible with ${offset}ms clock offset`, () => {
            const input = { ...catalog, nodes: [{id:'a',capacity:10}] };
            assert.equal(schedule(input,[report('a',10000+offset)],{},{now:10000}).a.assignments.length,1);
        });
        it(`accepts current generation read evidence with ${offset}ms clock offset`, () => {
            const current=Object.fromEntries(['a','b','c'].map(id=>{return [id,{generation:1,assignments:[{taskId:'s',generation:1,assignedAt:10000,specVersion:1,spec:{adapter:'test'}}]}]}));
            const reports=['a','b','c'].map(id=>{return report(id,10000+offset,[{taskId:'s',generation:1,state:'running',lastRead:10000+offset}])});
            assert.equal(Object.values(schedule(catalog,reports,current,{now:10000})).flatMap(row=>{return row.assignments}).length,2);
        });
    }
    it('rejects a report after an excessive forward clock jump and supports a configured bound', () => {
        assert.equal(schedule(catalog,[report('a',15001)],{},{now:10000}).a.assignments.length,0);
        assert.equal(schedule(catalog,[report('a',11001)],{},{now:10000,clockSkewMs:1000}).a.assignments.length,0);
    });
    it('rejects invalid clock skew bounds', () => {
        for(const clockSkewMs of [-1,0,Infinity,NaN]) { assert.throws(()=>{return schedule(catalog,[],{},{clockSkewMs})},/clock skew/u); }
    });
});

describe('conservative placement policy handoff', () => {
    const assignment = { taskId:'s', generation:1, assignedAt:0, specVersion:1, spec:{adapter:'test'} };
    const current = { a:{generation:1,catalogVersion:'v1',assignments:[assignment]} };
    const reading = (id, generation=1) => { return report(id,100000,[{taskId:'s',generation,state:'running',lastRead:100000}]); };
    for (const policy of [{eligibleNodes:['b']},{pinnedNode:'b'}]) {
        for (const retired of [false,true]) {
        it(`keeps the old reader until an eligible replacement confirms reads (${JSON.stringify(policy)}, retired=${retired})`, () => {
            const input={...catalog,version:'v2',nodes:catalog.nodes.filter(node=>{return !retired||node.id!=='a';}),tasks:[{...catalog.tasks[0],copies:1,...policy}]};
            const offline=schedule(input,[reading('a')],current,{now:100000});
            assert.equal(offline.a.assignments.length,1);
            const starting=schedule(input,[reading('a'),report('b',100000)],offline,{now:100000});
            assert.equal(starting.a.assignments.length,1);
            assert.equal(starting.b.assignments.length,1);
            const stale=schedule(input,[reading('a'),reading('b',0)],starting,{now:100000});
            assert.equal(stale.a.assignments.length,1);
            const confirmed=schedule(input,[reading('a'),reading('b',starting.b.assignments[0].generation)],starting,{now:100000});
            assert.equal(confirmed.a.assignments.length,0);
            assert.equal(confirmed.b.assignments.length,1);
        });
    }
    }
    it('does not restart the only healthy reader during a two-copy configuration update', () => {
        const input={...catalog,version:'v2',tasks:[{...catalog.tasks[0],spec:{adapter:'test',value:2}}]};
        const offline=schedule(input,[reading('a')],current,{now:100000});
        assert.deepEqual(offline.a.assignments[0].spec,assignment.spec);
        const starting=schedule(input,[reading('a'),report('b',100000)],offline,{now:100000});
        assert.deepEqual(starting.a.assignments[0].spec,assignment.spec);
        const confirmed=schedule(input,[reading('a'),reading('b',starting.b.assignments[0].generation)],starting,{now:100000});
        assert.equal(confirmed.a.assignments[0].spec.value,2);
    });
    it('updates a failed replica before touching the only healthy reader', () => {
        const input={...catalog,version:'v2',tasks:[{...catalog.tasks[0],spec:{adapter:'test',value:2}}]};
        const state={...current,b:{generation:1,catalogVersion:'v1',assignments:[assignment]}};
        const result=schedule(input,[reading('a'),report('b',100000,[{taskId:'s',generation:1,state:'failed'}])],state,{now:100000});
        assert.deepEqual(result.a.assignments[0].spec,assignment.spec);
        assert.equal(result.b.assignments[0].spec.value,2);
    });
    it('waits for the complete eligible replica count before retiring the old policy owner', () => {
        const input={...catalog,version:'v2',tasks:[{...catalog.tasks[0],eligibleNodes:['b','c']}]};
        const starting=schedule(input,[reading('a'),report('b',100000),report('c',100000)],current,{now:100000});
        const one=schedule(input,[reading('a'),reading('b',starting.b.assignments[0].generation),report('c',100000)],starting,{now:100000});
        assert.equal(one.a.assignments.length,1);
        const both=schedule(input,[reading('a'),reading('b',one.b.assignments[0].generation),reading('c',one.c.assignments[0].generation)],one,{now:100000});
        assert.equal(both.a.assignments.length,0);
    });
    it('honors explicit task deletion even if the old owner is ineligible', () => {
        assert.equal(schedule({...catalog,version:'v2',tasks:[]},[reading('a')],current,{now:100000}).a.assignments.length,0);
    });
});
describe('declared placement priority', () => {
    const nodes = [{ id: 'a', capacity: 10 }, { id: 'b', capacity: 10 }, { id: 'c', capacity: 10 }];
    it('keeps the preferred node even when another eligible node is less loaded', () => {
        const input = { version: 'v1', nodes, tasks: [
            { taskId: 'busy', spec: { adapter: 'test' }, pinnedNode: 'b', cost: 5 },
            { taskId: 's', spec: { adapter: 'test' }, copies: 1, preference: ['b', 'a'], eligibleNodes: ['a', 'b', 'c'] }
        ] };
        const result = schedule(input, ['a', 'b', 'c'].map((id) => { return report(id, 1000); }), {}, { now: 1000 });
        assert.equal(result.b.assignments.some((row) => { return row.taskId === 's'; }), true);
        assert.equal(result.a.assignments.some((row) => { return row.taskId === 's'; }), false);
    });
    it('moves a single calculation to the next preference when the preferred node is silent', () => {
        const input = { version: 'v1', nodes, tasks: [
            { taskId: 's', spec: { adapter: 'test' }, copies: 1, preference: ['b', 'a'], eligibleNodes: ['a', 'b'] }
        ] };
        const result = schedule(input, [report('a', 1000), report('c', 1000)], {}, { now: 1000 });
        assert.equal(result.a.assignments.some((row) => { return row.taskId === 's'; }), true);
    });
    it('skips a preferred node that has no remaining capacity', () => {
        const input = { version: 'v1', nodes: [{ id: 'b', capacity: 1 }, { id: 'a', capacity: 10 }], tasks: [
            { taskId: 'busy', spec: { adapter: 'test' }, pinnedNode: 'b', cost: 1 },
            { taskId: 's', spec: { adapter: 'test' }, copies: 1, cost: 1, preference: ['b', 'a'], eligibleNodes: ['a', 'b'] }
        ] };
        const result = schedule(input, [report('a', 1000), report('b', 1000)], {}, { now: 1000 });
        assert.equal(result.a.assignments.some((row) => { return row.taskId === 's'; }), true);
        assert.equal(result.b.assignments.some((row) => { return row.taskId === 's'; }), false);
    });
    it('calculates on the node that already stores the sensor', () => {
        const localNodes = [{ id: 'home', capacity: 10 }, { id: 'cache', capacity: 10 }];
        const input = { version: 'v1', nodes: localNodes, tasks: [
            { taskId: 'sensor', spec: { adapter: 'test' }, copies: 1, pinnedNode: 'cache' },
            { taskId: 'calc', spec: { adapter: 'test' }, copies: 1, preference: ['home', 'cache'], eligibleNodes: ['home', 'cache'], near: ['sensor'] }
        ] };
        const result = schedule(input, [report('home', 1000), report('cache', 1000)], {}, { now: 1000 });
        assert.equal(result.cache.assignments.some((row) => { return row.taskId === 'calc'; }), true);
        assert.equal(result.home.assignments.some((row) => { return row.taskId === 'calc'; }), false);
    });
    it('retires a lower preference after two preferred copies are confirmed', () => {
        const task = { taskId: 's', spec: { adapter: 'test' }, copies: 2, preference: ['c', 'b'], eligibleNodes: ['a', 'b', 'c'] };
        const current = Object.fromEntries(['a', 'b', 'c'].map((id) => { return [id, { generation: 1, assignments: [{ taskId: 's', generation: 1, specVersion: 1, spec: { adapter: 'test' } }] }]; }));
        const reports = ['a', 'b', 'c'].map((id) => { return report(id, 1000, [{ taskId: 's', generation: 1, state: 'running', lastRead: 1000 }]); });
        const result = schedule({ version: 'v1', nodes, tasks: [task] }, reports, current, { now: 1000 });
        assert.equal(result.a.assignments.length, 0);
        assert.equal(result.b.assignments.length, 1);
        assert.equal(result.c.assignments.length, 1);
    });
});
