function sameKey(left, right) {
    return left.key === right.key;
}

function findRow(store, key) {
    return store.operations.find((row) => {
        return sameKey(row, { key });
    });
}

function findScoped(store, machineId, key) {
    return store.operations.find((row) => {
        return row.machine === machineId && row.key === key;
    });
}

function missing(machineId, key) {
    return new Error(`operation '${key}' not found for machine '${machineId}'`);
}

/**
 * Inserts or replaces one in-memory operation row.
 *
 * @param {object} store - shared mutable store with operations array
 * @param {object} item - operation row
 * @returns {{created: boolean}} whether the key was new
 */
function putRow(store, item) {
    const row = findRow(store, item.key);
    if (row) {
        row.machine = item.machine;
        row.occurred_at = item.occurred_at;
        row.kind = item.kind;
        row.payload = item.payload;
        if (item.source_updated_at) {
            row.source_updated_at = item.source_updated_at;
        }
        return { created: false };
    }
    store.operations.push({ ...item });
    return { created: true };
}

function filterList(store, machineId, kind, range) {
    const from = range.from ?? null;
    const to = range.to ?? null;
    return store.operations.filter((row) => {
        if (row.machine !== machineId || row.kind !== kind) {
            return false;
        }
        if (from && new Date(row.occurred_at).getTime() < new Date(from).getTime()) {
            return false;
        }
        if (to && new Date(row.occurred_at).getTime() > new Date(to).getTime()) {
            return false;
        }
        return true;
    }).sort((left, right) => {
        return new Date(left.occurred_at) - new Date(right.occurred_at);
    });
}

/**
 * Picks the latest matching row for a machine and kind at a time bound.
 *
 * @param {object} store - shared mutable store with operations array
 * @param {string} machineId - machine identifier
 * @param {string} kind - operation kind
 * @param {{ to?: Date, before?: Date }} bound - inclusive to or exclusive before
 * @returns {object|null} latest row or null
 */
function filterLatest(store, machineId, kind, bound) {
    const range = bound || {};
    const before = range.before ? new Date(range.before).getTime() : null;
    const to = range.to ? new Date(range.to).getTime() : null;
    const matches = store.operations.filter((row) => {
        if (row.machine !== machineId || row.kind !== kind) {
            return false;
        }
        const at = new Date(row.occurred_at).getTime();
        if (before !== null && at >= before) {
            return false;
        }
        if (to !== null && at > to) {
            return false;
        }
        return true;
    }).sort((left, right) => {
        const delta = new Date(right.occurred_at) - new Date(left.occurred_at);
        if (delta !== 0) {
            return delta;
        }
        return String(right.key).localeCompare(String(left.key));
    });
    return matches[0] || null;
}

/**
 * In-memory operations state port for tests and local runs.
 *
 * @param {object} store - shared mutable store with operations array
 * @returns {object} operations port matching operationStatePg shape
 */
export default function operationStateMemory(store) {
    if (!store.operations) {
        store.operations = [];
    }
    return {
        upsert(item) {
            return Promise.resolve(putRow(store, item));
        },
        get(machineId, key) {
            const row = findScoped(store, machineId, key);
            if (!row) {
                return Promise.reject(missing(machineId, key));
            }
            return Promise.resolve(row);
        },
        remove(machineId, key) {
            const index = store.operations.findIndex((row) => {
                return row.machine === machineId && row.key === key;
            });
            if (index < 0) {
                return Promise.reject(missing(machineId, key));
            }
            const [row] = store.operations.splice(index, 1);
            return Promise.resolve(row);
        },
        listForMachine(machineId, kind, range) {
            return Promise.resolve(filterList(store, machineId, kind, range));
        },
        latestForMachine(machineId, kind, bound) {
            return Promise.resolve(filterLatest(store, machineId, kind, bound));
        },
        upsertMany(items) {
            return Promise.resolve(items.map((item) => {
                return putRow(store, item);
            }));
        }
    };
}
