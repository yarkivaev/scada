/**
 * On-demand export Query port over plantApi via scadaClient.
 *
 * Reads machines, measurements, segments, alerts, and operations by range.
 * Does not talk to storage directly and carries no plant-specific names.
 *
 * @param {object} client - scadaClient (or fake) with machines() and machine(id)
 * @returns {object} frozen query with machines, measurements, segments, alerts, operations
 *
 * @example
 *   const query = exportQuery(scadaClient(url, fetch, EventSource));
 *   const rows = await query.segments('furnace-α', { from, to });
 */
export default function exportQuery(client) {
    return Object.freeze({
        machines() {
            return client.machines();
        },
        measurements(machineId, range) {
            return client.machine(machineId).measurements(range);
        },
        segments(machineId, range) {
            return client.machine(machineId).segments(range);
        },
        alerts(machineId, options) {
            return client.machine(machineId).alerts(options || {});
        },
        operations(machineId, options) {
            return client.machine(machineId).operations(options || {});
        }
    });
}
