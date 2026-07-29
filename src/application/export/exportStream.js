/**
 * Streaming export Stream port over plantApi SSE via scadaClient.
 *
 * Opens measurement, segment, alert, and operation subscriptions.
 * Returns the same connection shape as scada/client (on/close).
 *
 * @param {object} client - scadaClient (or fake) with machine(id) stream methods
 * @returns {object} frozen stream with measurements, segments, alerts, operations
 *
 * @example
 *   const stream = exportStream(client);
 *   const conn = stream.segments('furnace-α');
 *   conn.on('segment_created', (row) => { sink.write([row]); });
 */
export default function exportStream(client) {
    return Object.freeze({
        measurements(machineId, options) {
            return client.machine(machineId).measurementStream(options || {});
        },
        segments(machineId) {
            return client.machine(machineId).segmentStream();
        },
        alerts(machineId) {
            return client.machine(machineId).alertStream();
        },
        operations(machineId, notify) {
            const listen = notify || ((payload) => {
                return payload;
            });
            return client.machine(machineId).operationsStream(listen);
        }
    });
}
