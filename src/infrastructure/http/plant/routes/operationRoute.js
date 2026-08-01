import machineInPlant from '../../../../application/machineInPlant.js';
import operationJson from '../json/operationJson.js';
import { jsonResponse, route } from '@yarkivaev/simple-server';

function parseRange(query) {
    const range = {};
    if (query.from) {
        range.from = new Date(query.from);
    }
    if (query.to) {
        range.to = new Date(query.to);
    }
    return range;
}

function resolveKinds(query) {
    if (query.kinds) {
        return query.kinds.split(',').map((token) => {
            return token.trim();
        }).filter((token) => {
            return token.length > 0;
        });
    }
    if (query.kind) {
        return [query.kind];
    }
    return undefined;
}

/**
 * Operations REST routes for machine-scoped reads.
 *
 * Parses singular `kind` or CSV `kinds` and delegates merge to
 * plant.operations.listForMachine (PG + injectable kindSources).
 *
 * @param {string} basePath - base URL path
 * @param {object} plant - plant domain object
 * @returns {array} route objects
 *
 * @example
 *   operationRoute('/api/v1', plant);
 */
export default function operationRoute(basePath, plant) {
    return [
        route('GET', `${basePath}/machines/:machineId/operations`, async (req, res, params, query) => {
            const result = machineInPlant(plant, params.machineId);
            if (!result || !plant.operations) {
                jsonResponse({ items: [] }).send(res);
                return;
            }
            const rows = await plant.operations.listForMachine(
                params.machineId,
                resolveKinds(query),
                parseRange(query)
            );
            jsonResponse({ items: rows.map(operationJson) }).send(res);
        })
    ];
}
