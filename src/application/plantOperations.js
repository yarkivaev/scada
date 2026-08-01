import operations from '../domain/operation/operations.js';
import pubsub from '../domain/shared/pubsub.js';

/**
 * Wires operations persistence to domain operations with SSE pubsub.
 *
 * Optional kindSources inject non-PG kinds into listForMachine merges.
 *
 * @param {object} persistence - operations store with upsert and listForMachine
 * @param {object} [kindSources] - map of kind to { list(machineId, range) }
 * @returns {object} operations with listForMachine, upsert, and stream
 *
 * @example
 *   const ops = plantOperations(dataAccess.operations, { temp: temperaturePort });
 *   plant(shops, { operations: ops });
 */
export default function plantOperations(persistence, kindSources) {
    return operations(persistence, pubsub(), kindSources);
}
