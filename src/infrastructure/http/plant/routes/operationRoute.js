import machineInPlant from '../../../../application/machineInPlant.js';
import operationJson from '../json/operationJson.js';
import timelineOperator from '../timelineOperator.js';
import operationWrites from './operationWrites.js';
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
 * Operations REST routes for machine-scoped reads and writes.
 *
 * Writes resolve operator via timelineOperator and stamp payload.operator.
 * Edge-owned machines proxy create/update/delete to the owning plant API
 * (no local upsert or decision insert). Optional owners registry mirrors timeline.
 *
 * @param {string} basePath - base URL path
 * @param {object} plant - plant domain object
 * @param {object} [operatorOptions] - timelineOperator options
 * @param {object} [decisions] - userDecisions port with insert
 * @param {object} [owners] - machineOwners registry
 * @returns {array} route objects
 *
 * @example
 *   operationRoute('/api/v1', plant, timelineOperatorOpts, decisions, owners);
 */
export default function operationRoute(basePath, plant, operatorOptions, decisions, owners) {
    const writes = operationWrites({
        plant,
        gate: timelineOperator(operatorOptions),
        decisions,
        owners
    });
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
        }),
        route('POST', `${basePath}/machines/:machineId/operations`, async (req, res, params) => {
            await writes.writeCreate(params.machineId, req, res);
        }),
        route('POST', `${basePath}/machines/:machineId/operations/batch`, async (req, res, params) => {
            await writes.writeCreateMany(params.machineId, req, res);
        }),
        route('PUT', `${basePath}/machines/:machineId/operations/:key`, async (req, res, params) => {
            await writes.writeUpdate(params.machineId, decodeURIComponent(params.key), req, res);
        }),
        route('DELETE', `${basePath}/machines/:machineId/operations/:key`, async (req, res, params) => {
            await writes.writeDelete(params.machineId, decodeURIComponent(params.key), req, res);
        })
    ];
}
