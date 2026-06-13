/**
 * Operations wired to persistence and a pubsub event bus.
 *
 * @param {object} persistence - store with listForMachine
 * @param {object} bus - pubsub instance with stream method
 * @returns {object} operations with listForMachine and stream
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
        stream: bus.stream
    };
}
