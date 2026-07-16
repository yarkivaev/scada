import operatorJson from '../json/operatorJson.js';
import { errorResponse, jsonResponse, readBody, route, sendRouteError } from '@yarkivaev/simple-server';

function routeFailure(code, message, status) {
    const err = new Error(message);
    err.routeCode = code;
    err.routeStatus = status;
    return err;
}

function sendKnown(res, err) {
    if (err && err.routeCode && err.routeStatus) {
        errorResponse(err.routeCode, err.message, err.routeStatus).send(res);
        return true;
    }
    return false;
}

function report(logger, message, err) {
    if (logger && typeof logger.error === 'function') {
        logger.error(message, err);
        return;
    }
    console.error(message, err); // eslint-disable-line no-console
}

function normalizeUid(raw) {
    return String(raw).trim().toUpperCase();
}

function draftFromBody(parsed) {
    if (!parsed || typeof parsed !== 'object') {
        throw routeFailure('BAD_REQUEST', 'operator body must be a JSON object', 400);
    }
    const { firstName, lastName, displayName } = parsed;
    const cardUid = normalizeUid(parsed.cardUid === undefined || parsed.cardUid === null ? '' : parsed.cardUid);
    if (!cardUid) {
        throw routeFailure('BAD_REQUEST', 'cardUid is required', 400);
    }
    if (typeof firstName !== 'string' || !firstName.trim()) {
        throw routeFailure('BAD_REQUEST', 'firstName is required', 400);
    }
    if (typeof lastName !== 'string' || !lastName.trim()) {
        throw routeFailure('BAD_REQUEST', 'lastName is required', 400);
    }
    if (typeof displayName !== 'string' || !displayName.trim()) {
        throw routeFailure('BAD_REQUEST', 'displayName is required', 400);
    }
    return { cardUid, firstName, lastName, displayName };
}

function flagFromBody(parsed) {
    if (!parsed || typeof parsed !== 'object') {
        throw routeFailure('BAD_REQUEST', 'registration body must be a JSON object', 400);
    }
    if (typeof parsed.enabled !== 'boolean') {
        throw routeFailure('BAD_REQUEST', 'enabled must be a boolean', 400);
    }
    return parsed.enabled;
}

async function handleGetEnabled(provider, logger, basePath, res) {
    try {
        const enabled = await provider.enabled();
        jsonResponse({ enabled }).send(res);
    } catch (err) {
        report(logger, `GET ${basePath}/operators/registration-enabled failed: ${err && err.message ? err.message : 'unknown error'}`, err);
        sendRouteError(res, err);
    }
}

async function handlePutEnabled(provider, logger, basePath, req, res) {
    try {
        const enabled = flagFromBody(JSON.parse(await readBody(req)));
        const stored = await provider.permit(enabled);
        jsonResponse({ enabled: stored }).send(res);
    } catch (err) {
        if (sendKnown(res, err)) {
            return;
        }
        report(logger, `PUT ${basePath}/operators/registration-enabled failed: ${err && err.message ? err.message : 'unknown error'}`, err);
        sendRouteError(res, err);
    }
}

async function handleList(provider, logger, basePath, res) {
    try {
        const rows = await provider.list();
        jsonResponse({ items: rows.map(operatorJson) }).send(res);
    } catch (err) {
        report(logger, `GET ${basePath}/operators failed: ${err && err.message ? err.message : 'unknown error'}`, err);
        sendRouteError(res, err);
    }
}

async function handleCreate(provider, logger, basePath, req, res) {
    try {
        const draft = draftFromBody(JSON.parse(await readBody(req)));
        const created = await provider.create(draft);
        jsonResponse(operatorJson(created)).send(res);
    } catch (err) {
        if (sendKnown(res, err)) {
            return;
        }
        report(logger, `POST ${basePath}/operators failed: ${err && err.message ? err.message : 'unknown error'}`, err);
        sendRouteError(res, err);
    }
}

/**
 * Operator catalog and registration routes for central plant API.
 *
 * @param {string} basePath - base URL path
 * @param {object} provider - operators provider with list, create, enabled, permit
 * @param {object} [logger] - optional logger with error(message, err)
 * @returns {array} route objects
 *
 * @example
 *   operatorRoute('/api/v1', operatorsFromPg(pool));
 */
export default function operatorRoute(basePath, provider, logger) {
    return [
        route('GET', `${basePath}/operators/registration-enabled`, async (req, res) => {
            await handleGetEnabled(provider, logger, basePath, res);
        }),
        route('PUT', `${basePath}/operators/registration-enabled`, async (req, res) => {
            await handlePutEnabled(provider, logger, basePath, req, res);
        }),
        route('GET', `${basePath}/operators`, async (req, res) => {
            await handleList(provider, logger, basePath, res);
        }),
        route('POST', `${basePath}/operators`, async (req, res) => {
            await handleCreate(provider, logger, basePath, req, res);
        })
    ];
}
