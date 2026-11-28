import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import agent from '../../../src/application/control/agent.js';
describe('embedded control agent', () => {
    it('ignores legacy assignment files and reads the controller after restart', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'assignment-'));
        const file = path.join(directory, 'snapshot.json');
        const legacy = JSON.stringify({ generation: 90, assignments: [
            { taskId: 'legacy', generation: 1, specVersion: 1, spec: { adapter: 'test' } }
        ] });
        let snapshot = { generation: 1, assignments: [{ taskId: 's', generation: 1, specVersion: 1, spec: { adapter: 'test' } }] };
        const store = { assignment() { if (!snapshot) { throw new Error('offline'); } return snapshot; }, report() {} };
        function runtime() {
            return { rows: [], apply(input) { this.rows = [input]; }, remove() { this.rows = []; }, status() { return { tasks: this.rows, fatal: false }; } };
        }
        await writeFile(file, legacy);
        const firstRuntime = runtime();
        const first = agent({ nodeId: 'a', file, store, runtime: firstRuntime, validate() {} });
        const secondRuntime = runtime();
        let second;
        try {
            await first.start();
            assert.deepEqual(firstRuntime.rows.map(row => { return row.taskId; }), ['s']);
            assert.equal(await readFile(file, 'utf8'), legacy);
            await first.stop();

            snapshot = null;
            second = agent({ nodeId: 'a', store, runtime: secondRuntime, validate() {} });
            await second.start();
            assert.equal(second.status().hasAssignment, false);
            assert.deepEqual(secondRuntime.rows, []);

            snapshot = { generation: 2, assignments: [{ taskId: 's', generation: 2, specVersion: 1, spec: { adapter: 'test' } }] };
            await second.tick();
            assert.equal(second.status().appliedGeneration, 2);
            assert.equal(secondRuntime.rows[0].taskId, 's');
            snapshot = { generation: 3, assignments: [] };
            await second.tick();
            assert.deepEqual(secondRuntime.rows, []);
        } finally {
            await first.stop();
            await second?.stop();
            await rm(directory, { recursive: true, force: true });
        }
    });
});

describe('assignment startup retry', () => {
    it('retries a failed task start on the same generation', async () => {
        const { default: createRuntime } = await import('../../../src/application/runtime/runtime.js');
        let attempts = 0;
        const runtime = createRuntime({ registry: new Map([['test', { validate() {}, resources() { return []; }, create() {
            return { start() { attempts += 1; if (attempts === 1) { throw new Error('temporary source failure'); } }, stop() {} };
        } }]]) });
        const input = { taskId: 's', generation: 1, specVersion: 1, spec: { adapter: 'test' } };
        await assert.rejects(runtime.apply(input), /temporary/u);
        await runtime.apply(input);
        assert.equal(attempts, 2);
        assert.equal(runtime.status().tasks[0].state, 'running');
        await runtime.stop();
    });
});
describe('control snapshot recovery epoch', () => {
    it('accepts a new epoch with lower remote generation and rebases local execution monotonically', async () => {
        let snapshot = { controlEpoch: 'before', generation: 50, assignments: [{ taskId: 's', generation: 50, specVersion: 1, spec: { adapter: 'test', value: 1 } }] };
        const applied = [];
        const reports = [];
        const runtime = { apply(input) { applied.push(input); }, remove() {}, status() { return { tasks: applied.length ? [applied.at(-1)] : [] }; } };
        const instance = agent({ nodeId: 'a', runtime, validate() {}, store: { assignment() { return snapshot; }, report(id, value) { reports.push(value); } } });
        try {
            await instance.start();
            snapshot = { controlEpoch: 'after', generation: 1, assignments: [{ taskId: 's', generation: 1, specVersion: 1, spec: { adapter: 'test', value: 2 } }] };
            await instance.tick();
            assert.equal(applied.at(-1).spec.value, 2);
            assert.ok(applied.at(-1).generation > applied[0].generation);
            assert.equal(reports.at(-1).tasks[0].generation, 1);
            assert.equal(reports.at(-1).tasks[0].executionGeneration, applied.at(-1).generation);
            const count = applied.length;
            snapshot = { ...snapshot, generation: 0 };
            await instance.tick();
            assert.equal(applied.length, count);
        } finally { await instance.stop(); }
    });
});

describe('partial assignment failure isolation', () => {
    it('starts healthy tasks after a failed source and retries them while control is offline', async () => {
        const { default: createRuntime } = await import('../../../src/application/runtime/runtime.js');
        const snapshot={generation:1,assignments:['bad','good'].map((taskId)=>{return {taskId,generation:1,specVersion:1,spec:{adapter:'test',fail:taskId==='bad'}};})};
        let available=false;
        let online=true;
        function runtime() { return createRuntime({registry:new Map([['test',{validate(){},resources(){return [];},create(spec){return {start(){if(spec.fail&&!available){throw new Error('source offline');}},stop(){}};}}]])}); }
        const host=runtime();
        const instance=agent({nodeId:'a',runtime:host,validate(){},store:{assignment(){if(!online){throw new Error('control offline');}return snapshot;},report(){}}});
        try {
            await instance.start();
            assert.equal(host.status().tasks.find((row)=>{return row.taskId==='good';})?.state,'running');
            assert.equal(instance.status().appliedGeneration,null);
            online=false;
            available=true; await instance.tick();
            assert.equal(host.status().tasks.find((row)=>{return row.taskId==='bad';})?.state,'running');
            assert.equal(host.status().tasks.find((row)=>{return row.taskId==='good';})?.state,'running');
            assert.equal(instance.status().appliedGeneration,1);
        } finally {await instance.stop(); await host.stop();}
    });
});
