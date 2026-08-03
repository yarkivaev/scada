import machineInPlant from '../../../../application/machineInPlant.js';
import operationJson from '../json/operationJson.js';
import timelineOperator from '../timelineOperator.js';
import { decisionRow, stampPayload } from '../operationAudit.js';
import { draftFromBody, draftFromUpdate } from './operationDrafts.js';
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

function isMissing(err) {
    return typeof err.message === 'string' && err.message.includes('not found for machine');
}

function sendFailure(gate, res, err) {
    if (gate && gate.sendError(res, err)) {
        return;
    }
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

function machineMissing(plant, machineId, res) {
    const result = machineInPlant(plant, machineId);
    if (!result || !plant.operations) {
        errorResponse('NOT_FOUND', `Machine '${machineId}' not found`, 404).send(res);
        return true;
    }
    return false;
}

async function record(decisions, machine, item, audit, verb) {
    if (!decisions || typeof decisions.insert !== 'function') {
        return;
    }
    await decisions.insert(decisionRow(machine, item, audit, verb));
}

async function readJson(req) {
    if (typeof req.on !== 'function') {
        return {};
    }
    const raw = await readBody(req);
    if (!raw || String(raw).trim().length === 0) {
        return {};
    }
    return JSON.parse(raw);
}

async function writeCreate(plant, gate, decisions, machineId, req, res) {
    if (machineMissing(plant, machineId, res)) {
        return;
    }
    try {
        const parsed = await readJson(req);
        const audit = await gate.resolve(parsed);
        const item = draftFromBody(machineId, parsed);
        item.payload = stampPayload(item.payload, audit);
        await plant.operations.upsert(item);
        await record(decisions, machineId, item, audit, 'create');
        jsonResponse(operationJson(item)).send(res);
    } catch (err) {
        sendFailure(gate, res, err);
    }
}

async function writeUpdate(plant, gate, decisions, machineId, key, req, res) {
    if (machineMissing(plant, machineId, res)) {
        return;
    }
    try {
        const parsed = await readJson(req);
        const audit = await gate.resolve(parsed);
        const existing = await plant.operations.get(machineId, key);
        const item = draftFromUpdate(machineId, key, existing, parsed);
        item.payload = stampPayload(item.payload, audit);
        await plant.operations.upsert(item);
        await record(decisions, machineId, item, audit, 'update');
        jsonResponse(operationJson(item)).send(res);
    } catch (err) {
        sendFailure(gate, res, err);
    }
}

async function writeDelete(plant, gate, decisions, machineId, key, req, res) {
    if (machineMissing(plant, machineId, res)) {
        return;
    }
    try {
        const parsed = await readJson(req);
        const audit = await gate.resolve(parsed);
        const item = await plant.operations.remove(machineId, key);
        await record(decisions, machineId, item, audit, 'delete');
        jsonResponse(operationJson(item)).send(res);
    } catch (err) {
        sendFailure(gate, res, err);
    }
}

/**
 * Operations REST routes for machine-scoped reads and writes.
 *
 * Writes resolve operator via timelineOperator and stamp payload.operator.
 * Optional userDecisions port records create/update/delete chronology.
 *
 * @param {string} basePath - base URL path
 * @param {object} plant - plant domain object
 * @param {object} [operatorOptions] - timelineOperator options
 * @param {object} [decisions] - userDecisions port with insert
 * @returns {array} route objects
 *
 * @example
 *   operationRoute('/api/v1', plant, timelineOperatorOpts, decisions);
 */
export default function operationRoute(basePath, plant, operatorOptions, decisions) {
    const gate = timelineOperator(operatorOptions);
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
            await writeCreate(plant, gate, decisions, params.machineId, req, res);
        }),
        route('PUT', `${basePath}/machines/:machineId/operations/:key`, async (req, res, params) => {
            await writeUpdate(
                plant, gate, decisions, params.machineId,
                decodeURIComponent(params.key), req, res
            );
        }),
        route('DELETE', `${basePath}/machines/:machineId/operations/:key`, async (req, res, params) => {
            await writeDelete(
                plant, gate, decisions, params.machineId,
                decodeURIComponent(params.key), req, res
            );
        })
    ];
}
