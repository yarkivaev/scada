/**
 * Builds a machineId → owner registry from EDGE_SITES-style site lists.
 *
 * Unknown machines resolve to local (STOMP) ownership.
 *
 * @param {Array<{baseUrl: string, token?: string, machines: string[]}>} sites - edge sites
 * @returns {object} frozen registry with resolve(machineId)
 *
 * @example
 *   const owners = machineOwners([
 *     { baseUrl: 'http://edge:3000/api/v1', token: 'secret', machines: ['m2'] }
 *   ]);
 *   owners.resolve('m2'); // { kind: 'edge', baseUrl, token }
 *   owners.resolve('m1'); // { kind: 'local' }
 */
export default function machineOwners(sites) {
    const map = new Map();
    for (const site of sites || []) {
        const owner = Object.freeze({
            kind: 'edge',
            baseUrl: site.baseUrl,
            token: site.token
        });
        for (const id of site.machines || []) {
            map.set(id, owner);
        }
    }
    return Object.freeze({
        /**
         * Resolves ownership for one machine.
         *
         * @param {string} machineId - machine identifier
         * @returns {object} { kind: 'local' } or { kind: 'edge', baseUrl, token }
         */
        resolve(machineId) {
            return map.get(machineId) || Object.freeze({ kind: 'local' });
        }
    });
}
