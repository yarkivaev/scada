import httpTimeline from './httpTimeline.js';

/**
 * Owner-routed timeline write factory.
 *
 * Local machines use the injected local write port (typically stompTimeline);
 * edge-owned machines proxy PATCH/respond to the owning plant API.
 *
 * @param {function(string): object} localTimeline - factory (machineId) => write port
 * @param {object} owners - registry with resolve(machineId) → local | edge owner
 * @returns {function(string): object} factory (machineId) => write port
 *
 * @example
 *   const write = ownerTimeline(
 *     (id) => stompTimeline(decisions, id),
 *     machineOwners([{ baseUrl: 'http://edge/api/v1', machines: ['m2'] }])
 *   );
 *   await write('m2').retag(start, ['heat'], {}, audit);
 */
export default function ownerTimeline(localTimeline, owners) {
    return function forMachine(machineId) {
        const owner = owners.resolve(machineId);
        if (owner.kind === 'edge') {
            return httpTimeline(owner, machineId);
        }
        return localTimeline(machineId);
    };
}
