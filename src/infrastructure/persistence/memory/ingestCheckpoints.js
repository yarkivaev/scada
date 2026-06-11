function findRow(store, machineId, kind) {
    return store.ingestCheckpoints.find((row) => {
        return row.machine === machineId && row.kind === kind;
    });
}

/**
 * In-memory ingest checkpoint port for tests and local runs.
 *
 * @param {object} store - shared mutable store with ingestCheckpoints array
 * @returns {object} ingest checkpoint port matching ingestCheckpointStatePg shape
 */
export default function ingestCheckpointStateMemory(store) {
    if (!store.ingestCheckpoints) {
        store.ingestCheckpoints = [];
    }
    return {
        read(machineId, kind) {
            const row = findRow(store, machineId, kind);
            return Promise.resolve(row ?? null);
        },
        upsert(machineId, kind, cursorAt) {
            const row = findRow(store, machineId, kind);
            if (row) {
                row.cursor_at = cursorAt;
                row.updated_at = new Date();
                return Promise.resolve();
            }
            store.ingestCheckpoints.push({
                machine: machineId,
                kind,
                cursor_at: cursorAt,
                updated_at: new Date()
            });
            return Promise.resolve();
        }
    };
}
