function stampRow(item, updatedAt) {
    return {
        machine: item.machine,
        occurred_at: item.occurred_at,
        kind: item.kind,
        key: item.key,
        payload: item.payload,
        source_updated_at: updatedAt
    };
}

/**
 * Operations wired to persistence and a pubsub event bus.
 *
 * @param {object} persistence - store with upsert and listForMachine
 * @param {object} bus - pubsub instance with stream and emit methods
 * @returns {object} operations with listForMachine, upsert, and stream
 *
 * @example
 *   const ops = operations(store, bus);
 *   await ops.listForMachine('icht1', 'chem', { from: new Date() });
 */
export default function operations(persistence, bus) {
    return {
        listForMachine(machineId, kind, range) {
            return persistence.listForMachine(machineId, kind, range);
        },
        upsert(item) {
            const updatedAt = new Date();
            const row = stampRow(item, updatedAt);
            return persistence.upsert(row).then((result) => {
                const type = result.created ? 'created' : 'updated';
                bus.emit({ type, operation: row });
            });
        },
        stream: bus.stream
    };
}
