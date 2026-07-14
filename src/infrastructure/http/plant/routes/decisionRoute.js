import decisionJson from '../json/decisionJson.js';
import { errorResponse, jsonResponse, route } from '@yarkivaev/simple-server';

/**
 * Segment user_decisions history route for central plant API.
 *
 * @param {string} basePath - base URL path
 * @param {object} catalog - user decisions port with list(machine, start)
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
        })
    ];
}
