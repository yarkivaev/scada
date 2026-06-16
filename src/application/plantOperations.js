import operations from '../domain/operation/operations.js';
import pubsub from '../domain/shared/pubsub.js';

/**
 * Wires operations persistence to domain operations with SSE pubsub.
 *
 * @param {object} persistence - operations store with upsert and listForMachine
 * @returns {object} operations with listForMachine, upsert, and stream
 *
 * @example
 *   const ops = plantOperations(dataAccess.operations);
 *   plant(shops, { operations: ops });
 */
export default function plantOperations(persistence) {
    return operations(persistence, pubsub());
}
