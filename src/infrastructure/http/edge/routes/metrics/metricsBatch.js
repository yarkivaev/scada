import { hasAccess, sendForbidden } from '../../stateAccess.js';
import { errorResponse, jsonResponse, readBody } from '@yarkivaev/simple-server';

/**
 * @param {string} raw - JSON body
 * @returns {Array<{topic: string, ts: string|Date, value: number}>}
 */
function itemsFromBody(raw) {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) {
        throw new Error('body must be an object with items array');
    }
    return parsed.items;
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {object} metrics - metrics state port
 * @returns {Promise<void>}
 */
async function runBatch(req, res, metrics) {
    let items;
    try {
        items = itemsFromBody(await readBody(req));
    } catch (err) {
        errorResponse('BAD_REQUEST', String(err.message), 400).send(res);
        return;
    }
    if (items.length === 0) {
        jsonResponse({ inserted: 0 }).send(res);
        return;
    }
    if (items.length > 500) {
        errorResponse('BAD_REQUEST', 'items length exceeds maximum of 500', 400).send(res);
        return;
    }
    await metrics.insertRows(items);
    jsonResponse({ inserted: items.length }).send(res);
}

/**
 * Batch insert into metrics (MQTT pipeline sink).
 *
 * @param {string|null} token - optional bearer token
 * @param {object} metrics - metrics state port
 * @returns {function} route handler
 */
export default function metricsBatch(token, metrics) {
    return async (req, res, params, query) => {
        void params;
        void query;
        if (!hasAccess(req, token)) {
            sendForbidden(res);
            return;
        }
        await runBatch(req, res, metrics);
    };
}
