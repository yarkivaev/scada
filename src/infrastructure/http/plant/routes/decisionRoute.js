import decisionJson from '../json/decisionJson.js';
import { errorResponse, jsonResponse, route } from '@yarkivaev/simple-server';

/**
 * Segment and operation user_decisions history routes.
 *
 * @param {string} basePath - base URL path
 * @param {object} catalog - user decisions port with list and listByKey
 * @returns {array} route objects
 *
 * @example
 *   decisionRoute('/api/v1', userDecisionsFromPg(pool));
 */
export default function decisionRoute(basePath, catalog) {
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
            if (typeof catalog.listByKey !== 'function') {
                jsonResponse({ items: [] }).send(res);
                return;
            }
            const key = decodeURIComponent(params.key);
            if (!key) {
                errorResponse('BAD_REQUEST', 'operation key is required', 400).send(res);
                return;
            }
            const rows = await catalog.listByKey(decodeURIComponent(params.machineId), key);
            jsonResponse({ items: rows.map(decisionJson) }).send(res);
        })
    ];
}
