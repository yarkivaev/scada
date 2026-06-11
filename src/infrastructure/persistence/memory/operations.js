function sameKey(left, right) {
    return left.external_key === right.external_key;
}

function findRow(store, externalKey) {
    return store.operations.find((row) => {
        return sameKey(row, { external_key: externalKey });
    });
}

function latestUpdatedAt(store, machineId, kind) {
    return store.operations.filter((row) => {
        return row.machine === machineId && row.kind === kind;
    }).reduce((left, row) => {
        const stamp = new Date(row.source_updated_at);
        if (!left || stamp.getTime() > left.getTime()) {
            return stamp;
        }
        return left;
    }, null);
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
            const row = findRow(store, item.external_key);
            if (row) {
                row.machine = item.machine;
                row.occurred_at = item.occurred_at;
                row.kind = item.kind;
                row.payload = item.payload;
                row.source_updated_at = item.source_updated_at;
                row.source_id = item.source_id;
                row.ingested_at = item.ingested_at;
                return Promise.resolve();
            }
            store.operations.push({ ...item });
            return Promise.resolve();
        },
        listForMachine(machineId, kind, range) {
            return Promise.resolve(filterList(store, machineId, kind, range));
        },
        latestSourceUpdatedAt(machineId, kind) {
            return Promise.resolve(latestUpdatedAt(store, machineId, kind));
        }
    };
}
