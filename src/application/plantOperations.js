import operations from '../domain/operation/operations.js';
import pubsub from '../domain/shared/pubsub.js';

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
 * Wraps operations persistence with SSE pubsub and upsert hook.
 *
 * @param {object} persistence - operations port with upsert and listForMachine
 * @returns {object} port for plant read/stream and upsert with bus emit
 *
 * @example
 *   const wrapped = plantOperations(dataAccess.operations);
 *   plant(shops, { operations: wrapped.port });
 */
export default function plantOperations(persistence) {
    const bus = pubsub();
    const read = {
        listForMachine(machineId, kind, range) {
            return persistence.listForMachine(machineId, kind, range);
        }
    };
    const port = operations(read, bus);
    return {
        port,
        bus,
        upsert(item) {
            const updatedAt = new Date();
            const row = stampRow(item, updatedAt);
            return persistence.upsert(row).then((result) => {
                const type = result.created ? 'created' : 'updated';
                bus.emit({ type, operation: row });
            });
        }
    };
}
