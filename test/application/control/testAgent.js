import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import agent from '../../../src/application/control/agent.js';
describe('embedded control agent', () => {
    it('persists before applying, survives offline restart, and removes omitted tasks', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'assignment-'));
        const file = path.join(directory, 'snapshot.json');
        let snapshot = { generation: 1, assignments: [{ taskId: 's', generation: 1, specVersion: 1, spec: { adapter: 'test' } }] };
        let offline = false;
        const runtime = { rows: [], apply(input) { this.rows = [input]; }, remove() { this.rows = []; }, status() { return { tasks: this.rows, fatal: false }; } };
        const store = { assignment() { if (offline) { throw new Error('offline'); } return Promise.resolve(snapshot); }, report() { return Promise.resolve(); } };
        try {
            const first = agent({ nodeId: 'a', file, store, runtime, validate() {} });
            await first.start();
            assert.equal(runtime.rows.length, 1);
            await first.stop();
            runtime.rows = [];
            offline = true;
            const second = agent({ nodeId: 'a', file, store, runtime, validate() {} });
            await second.start();
            assert.equal(runtime.rows.length, 1);
            offline = false;
            snapshot = { generation: 2, assignments: [] };
            await second.tick();
            assert.equal(runtime.rows.length, 0);
            await second.stop();
        } finally { await rm(directory, { recursive: true, force: true }); }
    });
    it('does not stop a running task when control is unavailable', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'assignment-'));
        const runtime = { status() { return { tasks: [{ taskId: 's' }] }; }, remove() { throw new Error('must not remove'); } };
        const instance = agent({ nodeId: 'a', file: path.join(directory, 'snapshot.json'), runtime, store: { assignment() { throw new Error('offline'); } }, validate() {} });
        try { await instance.start(); await instance.tick(); await instance.stop(); } finally { await rm(directory, { recursive: true, force: true }); }
    });
});

describe('assignment startup retry', () => {
    it('retries a failed task start on the same saved generation', async () => {
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
        const directory = await mkdtemp(path.join(tmpdir(), 'assignment-'));
        let snapshot = { controlEpoch: 'before', generation: 50, assignments: [{ taskId: 's', generation: 50, specVersion: 1, spec: { adapter: 'test', value: 1 } }] };
        const applied = [];
        const reports = [];
        const runtime = { apply(input) { applied.push(input); }, remove() {}, status() { return { tasks: applied.length ? [applied.at(-1)] : [] }; } };
        const instance = agent({ nodeId: 'a', file: path.join(directory, 'snapshot.json'), runtime, validate() {}, store: { assignment() { return snapshot; }, report(id, value) { reports.push(value); } } });
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
            await instance.stop();
        } finally { await rm(directory, { recursive: true, force: true }); }
    });
});

describe('partial assignment failure isolation', () => {
    it('starts healthy tasks after a failed source, including offline cached restart', async () => {
        const { default: createRuntime } = await import('../../../src/application/runtime/runtime.js');
        const directory=await mkdtemp(path.join(tmpdir(),'partial-'));
        const file=path.join(directory,'snapshot.json');
        const snapshot={generation:1,assignments:['bad','good'].map((taskId)=>{return {taskId,generation:1,specVersion:1,spec:{adapter:'test',fail:taskId==='bad'}};})};
        let available=false;
        function runtime() { return createRuntime({registry:new Map([['test',{validate(){},resources(){return [];},create(spec){return {start(){if(spec.fail&&!available){throw new Error('source offline');}},stop(){}};}}]])}); }
        let host=runtime(); let instance;
        try {
            instance=agent({nodeId:'a',file,runtime:host,validate(){},store:{assignment(){return snapshot;},report(){}}});
            await instance.start();
            assert.equal(host.status().tasks.find((row)=>{return row.taskId==='good';})?.state,'running');
            await instance.stop(); await host.stop();
            host=runtime();
            instance=agent({nodeId:'a',file,runtime:host,validate(){},store:{assignment(){throw new Error('control offline');},report(){}}});
            await instance.start();
            assert.equal(host.status().tasks.find((row)=>{return row.taskId==='good';})?.state,'running');
            available=true; await instance.tick();
            assert.equal(host.status().tasks.find((row)=>{return row.taskId==='bad';})?.state,'running');
        } finally {await instance?.stop(); await host.stop(); await rm(directory,{recursive:true,force:true});}
    });
});
