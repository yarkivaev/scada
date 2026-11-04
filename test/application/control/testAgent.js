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
