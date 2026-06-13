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
 * @param {object} persistence - operations store with upsert and listForMachine
 * @returns {object} operations with listForMachine, stream, and upsert
 *
 * @example
 *   const ops = plantOperations(dataAccess.operations);
 *   plant(shops, { operations: ops });
 */
export default function plantOperations(persistence) {
    const bus = pubsub();
    const ops = operations(persistence, bus);
    return {
        ...ops,
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
