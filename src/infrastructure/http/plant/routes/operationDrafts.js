import { randomUUID } from 'node:crypto';

function reject(code, message, status) {
    const err = new Error(message);
    err.routeCode = code;
    err.routeStatus = status;
    return err;
}

/**
 * Builds a create draft from a parsed POST body.
 *
 * @param {string} machineId - machine id
 * @param {object} parsed - JSON body
 * @returns {object} operation draft
 */
export function draftFromBody(machineId, parsed) {
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

/**
 * Builds an update draft from existing row and parsed PUT body.
 *
 * @param {string} machineId - machine id
 * @param {string} key - operation key
 * @param {object} existing - current row
 * @param {object} parsed - JSON body
 * @returns {object} operation draft
 */
export function draftFromUpdate(machineId, key, existing, parsed) {
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

const BATCH_LIMIT = 50;

/**
 * Builds create drafts from a batch POST body.
 *
 * @param {string} machineId - machine id
 * @param {object} parsed - JSON body with items array
 * @returns {Array<object>} operation drafts in request order
 */
export function draftsFromBatch(machineId, parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw reject('BAD_REQUEST', 'operation body must be a JSON object', 400);
    }
    if (!Array.isArray(parsed.items)) {
        throw reject('BAD_REQUEST', 'items must be an array', 400);
    }
    if (parsed.items.length === 0) {
        throw reject('BAD_REQUEST', 'items must not be empty', 400);
    }
    if (parsed.items.length > BATCH_LIMIT) {
        throw reject('BAD_REQUEST', `items cannot exceed ${BATCH_LIMIT} operations`, 400);
    }
    return parsed.items.map((item) => {
        return draftFromBody(machineId, item);
    });
}
