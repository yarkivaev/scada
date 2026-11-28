/** Process-local compare-and-swap state with a shared byte and record limit. */
export default function taskStateMemory({ maxBytes = 4 * 1024 * 1024, maxRecords = 1024 } = {}) {
    if (![maxBytes, maxRecords].every(value => { return Number.isSafeInteger(value) && value > 0; })) {
        throw new TypeError('Positive task state limits required');
    }
    const entries = new Map();
    let used = 0;
    let version = 0;
    function remove(taskId) {
        used -= entries.get(taskId).bytes;
        entries.delete(taskId);
    }
    function save(taskId, json, bytes) {
        if (entries.has(taskId)) { remove(taskId); }
        version += 1;
        entries.set(taskId, { json, bytes, version });
        used += bytes;
        return version;
    }
    return {
        load(taskId) {
            const item = entries.get(taskId);
            return Promise.resolve(item ? { ...JSON.parse(item.json), version: item.version } : null);
        },
        commit({ taskId, expectedVersion, ownership, stateVersion, compatibilityKey, checkpoint, pending }) {
            if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) { throw new TypeError('Invalid expectedVersion'); }
            if (ownership !== undefined) { throw new Error('This store has no external ownership integration'); }
            const current = entries.get(taskId);
            if (expectedVersion !== (current?.version ?? 0)) { throw new Error('Task state conflict'); }
            const json = JSON.stringify({ taskId, stateVersion, compatibilityKey, checkpoint, pending });
            const bytes = Buffer.byteLength(json);
            if ((!current && entries.size >= maxRecords) || used - (current?.bytes ?? 0) + bytes > maxBytes) {
                throw new Error('Task state capacity exceeded');
            }
            return Promise.resolve(save(taskId, json, bytes));
        },
        forget(taskId) { if (entries.has(taskId)) { remove(taskId); } },
        close() { entries.clear(); used = 0; }
    };
}
