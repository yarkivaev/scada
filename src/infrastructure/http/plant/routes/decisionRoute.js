import decisionJson from '../json/decisionJson.js';
import httpOperations from '../../../messaging/ownership/httpOperations.js';
import { errorResponse, jsonResponse, route } from '@yarkivaev/simple-server';

function edgePort(owners, machineId) {
    if (!owners || typeof owners.resolve !== 'function') {
        return undefined;
    }
    const owner = owners.resolve(machineId);
    if (!owner || owner.kind !== 'edge') {
        return undefined;
    }
    return httpOperations(owner, machineId);
}

/**
 * Segment and operation user_decisions history routes.
 *
 * Operation chronology for edge-owned machines is proxied to the owner API.
 *
 * @param {string} basePath - base URL path
 * @param {object} catalog - user decisions port with list and listByKey
 * @param {object} [owners] - machineOwners registry
 * @returns {array} route objects
 *
 * @example
 *   decisionRoute('/api/v1', userDecisionsFromPg(pool), owners);
 */
export default function decisionRoute(basePath, catalog, owners) {
    return [
        route('GET', `${basePath}/machines/:machineId/segments/:start/decisions`, async (req, res, params) => {
            const start = new Date(decodeURIComponent(params.start));
            if (Number.isNaN(start.getTime())) {
                errorResponse('BAD_REQUEST', `Invalid segment start '${params.start}'`, 400).send(res);
                return;
            }
            const rows = await catalog.list(decodeURIComponent(params.machineId), start);
            jsonResponse({ items: rows.map(decisionJson) }).send(res);
        }),
        route('GET', `${basePath}/machines/:machineId/operations/:key/decisions`, async (req, res, params) => {
            const machineId = decodeURIComponent(params.machineId);
            const key = decodeURIComponent(params.key);
            if (!key) {
                errorResponse('BAD_REQUEST', 'operation key is required', 400).send(res);
                return;
            }
            const port = edgePort(owners, machineId);
            if (port) {
                jsonResponse({ items: await port.decisions(key) }).send(res);
                return;
            }
            if (typeof catalog.listByKey !== 'function') {
                jsonResponse({ items: [] }).send(res);
                return;
            }
            const rows = await catalog.listByKey(machineId, key);
            jsonResponse({ items: rows.map(decisionJson) }).send(res);
        })
    ];
}
