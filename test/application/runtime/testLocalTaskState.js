import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runCollector } from '@yarkivaev/scada/runtime';

function existingCheckpoint(directory) {
    const db = new Database(path.join(directory, 'task-state.sqlite'));
    try {
        db.exec('CREATE TABLE collector_task_state (task_id TEXT PRIMARY KEY, version INTEGER NOT NULL, document TEXT NOT NULL)');
        db.prepare('INSERT INTO collector_task_state (task_id, version, document) VALUES (?, ?, ?)')
            .run('sensor', 4, '{"taskId":"sensor","stateVersion":1,"compatibilityKey":"fixture","checkpoint":{"offset":41},"pending":null}');
    } finally { db.close(); }
}

describe('collector local task state', function () {
    it('reopens the existing spool directory SQLite checkpoint after restart', async function () {
        const directory = await mkdtemp(path.join(tmpdir(), 'collector-state-'));
        const saved = [];
        const registry = new Map([['test', {
            validate() {}, resources() { return []; },
            create(_spec, { stateStore }) {
                return { async start() {
                    const checkpoint = await stateStore?.load('sensor');
                    saved.push(checkpoint ?? null);
                    await stateStore?.commit({ taskId: 'sensor', expectedVersion: checkpoint?.version ?? 0,
                        stateVersion: 1, compatibilityKey: 'fixture', checkpoint: { offset: 42 }, pending: null });
                }, stop() {} };
            }
        }]]);
        const options = { registry, localTaskState: true, signals: false, argv: [],
            env: { COLLECTOR_SPOOL_DIR: directory, COLLECTOR_SPOOL_MAX_BYTES: '10485760',
                COLLECTOR_MANIFEST: JSON.stringify({ assignments: [
                    { taskId: 'sensor', generation: 1, specVersion: 1, spec: { adapter: 'test' } }
                ] }) } };
        try {
            existingCheckpoint(directory);
            await (await runCollector(options)).stop();
            await (await runCollector(options)).stop();
            assert.deepEqual(saved, [
                { version: 4, taskId: 'sensor', stateVersion: 1, compatibilityKey: 'fixture', checkpoint: { offset: 41 }, pending: null },
                { version: 5, taskId: 'sensor', stateVersion: 1, compatibilityKey: 'fixture', checkpoint: { offset: 42 }, pending: null }
            ]);
        } finally { await rm(directory, { recursive: true, force: true }); }
    });
});
