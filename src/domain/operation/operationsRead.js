/**
 * Read-only operations port wired to a pubsub event bus.
 *
 * @param {object} read - read port with listForMachine
 * @param {object} bus - pubsub instance with stream method
 * @returns {object} operations with listForMachine and stream
 *
 * @example
 *   const port = operationsRead(store, bus);
 *   await port.listForMachine('icht1', 'chem', { from: new Date() });
 */
export default function operationsRead(read, bus) {
    return {
        listForMachine(machineId, kind, range) {
            return read.listForMachine(machineId, kind, range);
        },
        stream: bus.stream
    };
}
