import { randomUUID } from 'node:crypto';
import machineInPlant from '../../../../application/machineInPlant.js';
import operationJson from '../json/operationJson.js';
import { errorResponse, jsonResponse, readBody, route, sendRouteError } from '@yarkivaev/simple-server';

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

function reject(code, message, status) {
    const err = new Error(message);
    err.routeCode = code;
    err.routeStatus = status;
    return err;
}

function isMissing(err) {
    return typeof err.message === 'string' && err.message.includes('not found for machine');
}

function sendFailure(res, err) {
    if (err.routeCode && err.routeStatus) {
        errorResponse(err.routeCode, err.message, err.routeStatus).send(res);
        return;
    }
    if (isMissing(err)) {
        errorResponse('NOT_FOUND', err.message, 404).send(res);
        return;
    }
    sendRouteError(res, err);
}

function draftFromBody(machineId, parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw reject('BAD_REQUEST', 'operation body must be a JSON object', 400);
    }
    if (typeof parsed.kind !== 'string' || parsed.kind.length === 0) {
        throw reject('BAD_REQUEST', 'kind is required', 400);
    }
    if (parsed.payload === undefined) {
        throw reject('BAD_REQUEST', 'payload is required', 400);
    }
    const occurred = parsed.occurred_at === undefined ? new Date() : new Date(parsed.occurred_at);
    if (Number.isNaN(occurred.getTime())) {
        throw reject('BAD_REQUEST', 'occurred_at must be a valid timestamp', 400);
    }
    const key = parsed.key === undefined || parsed.key === null
        ? `${parsed.kind}:${machineId}:${randomUUID()}`
        : parsed.key;
    if (typeof key !== 'string' || key.length === 0) {
        throw reject('BAD_REQUEST', 'key must be a non-empty string', 400);
    }
    return {
        machine: machineId,
        kind: parsed.kind,
        key,
        occurred_at: occurred,
        payload: parsed.payload
    };
}

function draftFromUpdate(machineId, key, existing, parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw reject('BAD_REQUEST', 'operation body must be a JSON object', 400);
    }
    if (parsed.payload === undefined) {
        throw reject('BAD_REQUEST', 'payload is required', 400);
    }
    const kind = parsed.kind === undefined ? existing.kind : parsed.kind;
    if (typeof kind !== 'string' || kind.length === 0) {
        throw reject('BAD_REQUEST', 'kind must be a non-empty string', 400);
    }
    const occurred = parsed.occurred_at === undefined
        ? new Date(existing.occurred_at)
        : new Date(parsed.occurred_at);
    if (Number.isNaN(occurred.getTime())) {
        throw reject('BAD_REQUEST', 'occurred_at must be a valid timestamp', 400);
    }
    return {
        machine: machineId,
        kind,
        key,
        occurred_at: occurred,
        payload: parsed.payload
    };
}

function machineMissing(plant, machineId, res) {
    const result = machineInPlant(plant, machineId);
    if (!result || !plant.operations) {
        errorResponse('NOT_FOUND', `Machine '${machineId}' not found`, 404).send(res);
        return true;
    }
    return false;
}

async function createOperation(plant, machineId, req, res) {
    if (machineMissing(plant, machineId, res)) {
        return;
    }
    try {
        const item = draftFromBody(machineId, JSON.parse(await readBody(req)));
        await plant.operations.upsert(item);
        jsonResponse(operationJson(item)).send(res);
    } catch (err) {
        sendFailure(res, err);
    }
}

async function updateOperation(plant, machineId, key, req, res) {
    if (machineMissing(plant, machineId, res)) {
        return;
    }
    try {
        const existing = await plant.operations.get(machineId, key);
        const item = draftFromUpdate(machineId, key, existing, JSON.parse(await readBody(req)));
        await plant.operations.upsert(item);
        jsonResponse(operationJson(item)).send(res);
    } catch (err) {
        sendFailure(res, err);
    }
}

async function deleteOperation(plant, machineId, key, res) {
    if (machineMissing(plant, machineId, res)) {
        return;
    }
    try {
        const item = await plant.operations.remove(machineId, key);
        jsonResponse(operationJson(item)).send(res);
    } catch (err) {
        sendFailure(res, err);
    }
}

/**
 * Operations REST routes for machine-scoped reads and writes.
 *
 * Parses singular `kind` or CSV `kinds` and delegates merge to
 * plant.operations.listForMachine (PG + injectable kindSources).
 * POST upserts via plant.operations.upsert with generated key when omitted.
 * PUT updates an existing key; DELETE removes by machine-scoped key.
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
        }),
        route('POST', `${basePath}/machines/:machineId/operations`, async (req, res, params) => {
            await createOperation(plant, params.machineId, req, res);
        }),
        route('PUT', `${basePath}/machines/:machineId/operations/:key`, async (req, res, params) => {
            await updateOperation(plant, params.machineId, decodeURIComponent(params.key), req, res);
        }),
        route('DELETE', `${basePath}/machines/:machineId/operations/:key`, async (req, res, params) => {
            await deleteOperation(plant, params.machineId, decodeURIComponent(params.key), res);
        })
    ];
}
