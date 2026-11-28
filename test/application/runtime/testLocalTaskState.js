import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCollector } from '@yarkivaev/scada/runtime';
import taskStateMemory from '../../../src/infrastructure/persistence/runtime/taskStateMemory.js';

describe('collector local task state', () => {
    it('uses volatile state and leaves legacy storage untouched even when old settings exist', async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'collector-state-'));
        const stateFile = path.join(directory, 'task-state.sqlite');
        const saved = [];
        const registry = new Map([['test', {
            validate() {}, resources() { return []; },
            create(_spec, { stateStore }) {
                return { async start() {
                    saved.push(await stateStore.load('sensor'));
                    await stateStore.commit({ taskId: 'sensor', expectedVersion: 0, stateVersion: 1,
                        compatibilityKey: 'fixture', checkpoint: { offset: 42 }, pending: null });
                    assert.deepEqual((await stateStore.load('sensor')).checkpoint, { offset: 42 });
                }, stop() {} };
            }
        }]]);
        const options = { registry, localTaskState: true, signals: false, argv: [],
            env: { COLLECTOR_SPOOL_DIR: directory, COLLECTOR_SPOOL_MAX_BYTES: '1000000',
                COLLECTOR_STATE_URL: 'postgres://127.0.0.1:1/unreachable',
                COLLECTOR_QUEUE_MAX_BYTES: '1000000', COLLECTOR_QUEUE_MAX_RECORDS: '20',
                COLLECTOR_MANIFEST: JSON.stringify({ assignments: [
                    { taskId: 'sensor', generation: 1, specVersion: 1, spec: { adapter: 'test' } }
                ] }) } };
        try {
            await writeFile(stateFile, 'legacy file');
            await (await runCollector(options)).stop();
            await (await runCollector(options)).stop();
            assert.deepEqual(saved, [null, null]);
            assert.deepEqual(await readdir(directory), ['task-state.sqlite']);
            assert.equal(await readFile(stateFile, 'utf8'), 'legacy file');
        } finally { await rm(directory, { recursive: true, force: true }); }
    });
    it('preserves a live checkpoint when another task cannot fit and releases retired tasks', async () => {
        const store = taskStateMemory({ maxRecords: 1 });
        const state = { taskId: 'a', expectedVersion: 0, checkpoint: { offset: 1 } };
        const first = await store.commit(state);
        assert.throws(() => { store.commit({ ...state, taskId: 'b' }); }, /capacity/u);
        assert.equal((await store.load('a')).version, first);
        await store.commit({ ...state, expectedVersion: first, checkpoint: { offset: 2 } });
        store.forget('a');
        assert.equal(await store.load('a'), null);
        assert.ok(await store.commit({ ...state, taskId: 'b' }) > first);
    });
});
