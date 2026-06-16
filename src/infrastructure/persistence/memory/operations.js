function sameKey(left, right) {
    return left.key === right.key;
}

function findRow(store, key) {
    return store.operations.find((row) => {
        return sameKey(row, { key });
    });
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
            const row = findRow(store, item.key);
            if (row) {
                row.machine = item.machine;
                row.occurred_at = item.occurred_at;
                row.kind = item.kind;
                row.payload = item.payload;
                if (item.source_updated_at) {
                    row.source_updated_at = item.source_updated_at;
                }
                return Promise.resolve({ created: false });
            }
            store.operations.push({ ...item });
            return Promise.resolve({ created: true });
        },
        listForMachine(machineId, kind, range) {
            return Promise.resolve(filterList(store, machineId, kind, range));
        }
    };
}
