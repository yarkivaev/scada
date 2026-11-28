import Database from 'better-sqlite3';

function documentOf(input) {
    return { taskId: input.taskId, stateVersion: input.stateVersion, compatibilityKey: input.compatibilityKey,
        checkpoint: input.checkpoint, pending: input.pending };
}

function taskState(db, maxBytes) {
    db.exec('CREATE TABLE IF NOT EXISTS collector_task_state (task_id TEXT PRIMARY KEY, version INTEGER NOT NULL, document TEXT NOT NULL)');
    const select = db.prepare('SELECT version, document FROM collector_task_state WHERE task_id = ?');
    const insert = db.prepare('INSERT INTO collector_task_state (task_id, version, document) VALUES (?, 1, ?) ON CONFLICT(task_id) DO NOTHING');
    const update = db.prepare('UPDATE collector_task_state SET version = version + 1, document = ? WHERE task_id = ? AND version = ?');
    return {
        load(taskId) {
            const row = select.get(taskId);
            if (!row) { return Promise.resolve(null); }
            return Promise.resolve({ ...JSON.parse(row.document), version: Number(row.version) });
        },
        commit(input) {
            if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) { throw new TypeError('Invalid expectedVersion'); }
            if (input.ownership !== undefined) { throw new Error('This store has no external ownership integration'); }
            const json = JSON.stringify(documentOf(input));
            if (Buffer.byteLength(json) > maxBytes) { throw new Error('Task state capacity exceeded'); }
            const result = input.expectedVersion === 0 ? insert.run(input.taskId, json) : update.run(json, input.taskId, input.expectedVersion);
            if (!result.changes) { throw new Error('Task state conflict'); }
            return Promise.resolve(input.expectedVersion + 1);
        },
        close() { db.close(); }
    };
}

/** SQLite CAS store with the same load/commit shape as the PostgreSQL runtime table. */
export default function taskStateSqlite(file, { maxBytes = 1048576 } = {}) {
    const db = new Database(file);
    try { return taskState(db, maxBytes); }
    catch (error) { db.close(); throw error; }
}
