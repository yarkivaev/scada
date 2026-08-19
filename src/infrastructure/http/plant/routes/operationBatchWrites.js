import machineInPlant from '../../../../application/machineInPlant.js';
import operationJson from '../json/operationJson.js';
import { decisionRow, stampPayload } from '../operationAudit.js';
import { draftsFromBatch } from './operationDrafts.js';
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

function ownerItem(machineId, response, parsed) {
    return {
        machine: machineId,
        key: (response && (response.external_key || response.key)) || parsed.key,
        kind: (response && response.kind) || parsed.kind,
        occurred_at: (response && response.occurred_at) || parsed.occurred_at || new Date(),
        payload: (response && response.payload) || parsed.payload
    };
}

function forwardBatch(parsed, audit) {
    const body = { items: parsed.items };
    if (audit.id !== undefined && audit.id !== null) {
        body.operatorId = audit.id;
    }
    return body;
}

async function localCreateMany(ctx, machineId, parsed, audit) {
    const drafts = draftsFromBatch(machineId, parsed);
    drafts.forEach((item) => {
        item.payload = stampPayload(item.payload, audit);
    });
    await ctx.plant.operations.upsertMany(drafts);
    await drafts.reduce((chain, item) => {
        return chain.then(() => {
            return record(ctx.decisions, machineId, item, audit, 'create');
        });
    }, Promise.resolve());
    return drafts;
}

/**
 * Creates many operations in one request for a machine.
 *
 * Edge-owned machines proxy the batch body to the owning plant API.
 *
 * @param {object} ctx - plant, gate, decisions, owners
 * @param {string} machineId - machine identifier
 * @param {object} req - HTTP request
 * @param {object} res - HTTP response
 * @returns {Promise<void>}
 */
export default async function createMany(ctx, machineId, req, res) {
    if (machineMissing(ctx.plant, machineId, res)) {
        return;
    }
    try {
        const parsed = await readJson(req);
        const audit = await ctx.gate.resolve(parsed);
        const port = edgePort(ctx.owners, machineId);
        if (port) {
            const created = await port.createMany(forwardBatch(parsed, audit));
            const rows = Array.isArray(created && created.items) ? created.items : [];
            await rows.reduce((chain, row, index) => {
                return chain.then(() => {
                    const source = Array.isArray(parsed.items) ? parsed.items[index] || {} : {};
                    return record(ctx.decisions, machineId, ownerItem(machineId, row, source), audit, 'create');
                });
            }, Promise.resolve());
            jsonResponse(created).send(res);
            return;
        }
        const items = await localCreateMany(ctx, machineId, parsed, audit);
        jsonResponse({ items: items.map(operationJson) }).send(res);
    } catch (err) {
        sendFailure(ctx.gate, res, err);
    }
}
