async function publishMany(operations, publish, items) {
    if (typeof operations.upsertMany !== 'function') {
        throw new Error('Operations port must have an upsertMany() method');
    }
    await operations.upsertMany(items);
    for (const item of items) {
        // Preserve request order even when confirmation is asynchronous.
        // eslint-disable-next-line no-await-in-loop
        await publish(item);
    }
}

/** Publish operation changes once the local write succeeds. */
export default function publishingOperations(operations, publish) {
    if (!operations || typeof operations.upsert !== 'function') {
        throw new Error('Operations port must have an upsert() method');
    }
    if (typeof publish !== 'function') { throw new Error('Publish must be a function'); }
    return {
        listForMachine(machineId, kinds, range) {
            return operations.listForMachine(machineId, kinds, range);
        },
        latestForMachine(machineId, kind, bound) {
            if (typeof operations.latestForMachine !== 'function') {
                throw new Error('Operations port must have a latestForMachine() method');
            }
            return operations.latestForMachine(machineId, kind, bound);
        },
        stream: operations.stream,
        get(machineId, key) {
            return operations.get(machineId, key);
        },
        async upsert(item) {
            await operations.upsert(item);
            await publish(item);
        },
        upsertMany(items) {
            return publishMany(operations, publish, items);
        },
        async remove(machineId, key) {
            const removed = await operations.remove(machineId, key);
            await publish({
                type: 'deleted',
                machine: removed.machine,
                kind: removed.kind,
                key: removed.key,
                occurred_at: removed.occurred_at
            });
            return removed;
        }
    };
}
