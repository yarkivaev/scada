import machineInPlant from '../../../../application/machineInPlant.js';
import operationJson from '../json/operationJson.js';
import { decisionRow, stampPayload } from '../operationAudit.js';
import { draftFromBody, draftFromUpdate } from './operationDrafts.js';
import httpOperations from '../../../messaging/ownership/httpOperations.js';
import { errorResponse, jsonResponse, readBody, sendRouteError } from '@yarkivaev/simple-server';

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

function forwardBody(parsed, audit) {
    const body = { ...parsed };
    if (audit.id !== undefined && audit.id !== null) {
        body.operatorId = audit.id;
    }
    return body;
}

async function localCreate(ctx, machineId, parsed, audit) {
    const item = draftFromBody(machineId, parsed);
    item.payload = stampPayload(item.payload, audit);
    await ctx.plant.operations.upsert(item);
    await record(ctx.decisions, machineId, item, audit, 'create');
    return item;
}

async function localUpdate(ctx, machineId, key, parsed, audit) {
    const existing = await ctx.plant.operations.get(machineId, key);
    const item = draftFromUpdate(machineId, key, existing, parsed);
    item.payload = stampPayload(item.payload, audit);
    await ctx.plant.operations.upsert(item);
    await record(ctx.decisions, machineId, item, audit, 'update');
    return item;
}

async function localDelete(ctx, machineId, key, audit) {
    const item = await ctx.plant.operations.remove(machineId, key);
    await record(ctx.decisions, machineId, item, audit, 'delete');
    return item;
}

async function writeCreate(ctx, machineId, req, res) {
    if (machineMissing(ctx.plant, machineId, res)) {
        return;
    }
    try {
        const parsed = await readJson(req);
        const audit = await ctx.gate.resolve(parsed);
        const port = edgePort(ctx.owners, machineId);
        if (port) {
            jsonResponse(await port.create(forwardBody(parsed, audit))).send(res);
            return;
        }
        jsonResponse(operationJson(await localCreate(ctx, machineId, parsed, audit))).send(res);
    } catch (err) {
        sendFailure(ctx.gate, res, err);
    }
}

async function writeUpdate(ctx, machineId, key, req, res) {
    if (machineMissing(ctx.plant, machineId, res)) {
        return;
    }
    try {
        const parsed = await readJson(req);
        const audit = await ctx.gate.resolve(parsed);
        const port = edgePort(ctx.owners, machineId);
        if (port) {
            jsonResponse(await port.update(key, forwardBody(parsed, audit))).send(res);
            return;
        }
        jsonResponse(operationJson(await localUpdate(ctx, machineId, key, parsed, audit))).send(res);
    } catch (err) {
        sendFailure(ctx.gate, res, err);
    }
}

async function writeDelete(ctx, machineId, key, req, res) {
    if (machineMissing(ctx.plant, machineId, res)) {
        return;
    }
    try {
        const parsed = await readJson(req);
        const audit = await ctx.gate.resolve(parsed);
        const port = edgePort(ctx.owners, machineId);
        if (port) {
            jsonResponse(await port.remove(key, forwardBody(parsed, audit))).send(res);
            return;
        }
        jsonResponse(operationJson(await localDelete(ctx, machineId, key, audit))).send(res);
    } catch (err) {
        sendFailure(ctx.gate, res, err);
    }
}

/**
 * Builds create/update/delete handlers for operationRoute.
 *
 * Edge-owned machines proxy to the owning plant API without local upsert.
 *
 * @param {object} ctx - plant, gate, decisions, owners
 * @returns {object} writeCreate, writeUpdate, writeDelete
 */
export default function operationWrites(ctx) {
    return {
        writeCreate(machineId, req, res) {
            return writeCreate(ctx, machineId, req, res);
        },
        writeUpdate(machineId, key, req, res) {
            return writeUpdate(ctx, machineId, key, req, res);
        },
        writeDelete(machineId, key, req, res) {
            return writeDelete(ctx, machineId, key, req, res);
        }
    };
}
