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

function resolveKinds(query, sources) {
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
    return Object.keys(sources);
}

function loadKind(plant, sources, machineId, kind, range) {
    const source = sources[kind];
    if (source) {
        return source.list(machineId, range);
    }
    if (!plant.operations) {
        return Promise.resolve([]);
    }
    return plant.operations.listForMachine(machineId, kind, range);
}

function mergeKinds(plant, sources, machineId, kinds, range) {
    return Promise.all(kinds.map((kind) => {
        return loadKind(plant, sources, machineId, kind, range);
    })).then((batches) => {
        return batches.flat().sort((left, right) => {
            return new Date(left.occurred_at) - new Date(right.occurred_at);
        });
    });
}

/**
 * Operations REST routes for machine-scoped reads.
 *
 * Supports singular `kind`, CSV `kinds`, and injectable non-PG kind sources.
 * Kinds without a source fall back to plant.operations.listForMachine.
 *
 * @param {string} basePath - base URL path
 * @param {object} plant - plant domain object
 * @param {object} [kindSources] - map of kind to { list(machineId, range) }
 * @returns {array} route objects
 *
 * @example
 *   operationRoute('/api/v1', plant, { temp: temperaturePort });
 */
export default function operationRoute(basePath, plant, kindSources) {
    const sources = kindSources || {};
    return [
        route('GET', `${basePath}/machines/:machineId/operations`, async (req, res, params, query) => {
            const result = machineInPlant(plant, params.machineId);
            if (!result) {
                jsonResponse({ items: [] }).send(res);
                return;
            }
            const kinds = resolveKinds(query, sources);
            if (kinds.length === 0) {
                jsonResponse({ items: [] }).send(res);
                return;
            }
            const rows = await mergeKinds(plant, sources, params.machineId, kinds, parseRange(query));
            jsonResponse({ items: rows.map(operationJson) }).send(res);
        })
    ];
}
