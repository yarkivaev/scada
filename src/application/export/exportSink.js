/**
 * Generic export Sink port for outbound batches and artifacts.
 *
 * Destination adapters (HTTP, file, plant integrations) live outside this package.
 * This factory only freezes the write/send contract.
 *
 * @param {object} destination - object with write(records) and/or send(artifact)
 * @returns {object} frozen sink with write and send
 *
 * @example
 *   const sink = exportSink({
 *     write(records) { return http.post('/hook', records); },
 *     send(artifact) { return http.post('/doc', artifact); }
 *   });
 */
export default function exportSink(destination) {
    return Object.freeze({
        write(records) {
            return destination.write(records);
        },
        send(artifact) {
            return destination.send(artifact);
        }
    });
}
