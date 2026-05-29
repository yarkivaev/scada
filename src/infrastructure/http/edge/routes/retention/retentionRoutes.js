import { hasAccess, sendForbidden } from '../../stateAccess.js';
import { errorResponse, jsonResponse, route } from '@yarkivaev/simple-server';

function parseDays(raw, fallback) {
    if (raw === undefined || raw === '') {
        return fallback;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
        return null;
    }
    return value;
}

/**
 * Admin retention route for scheduled database cleanup.
 *
 * @param {string|null} token - optional bearer token
 * @param {object} pool - database pool passed to purge callback
 * @param {number} defaultDays - retention window from deployment env
 * @param {function} purge - async (pool, days) => cleanup result
 * @returns {Array<object>} route definitions
 */
export default function retentionRoutes(token, pool, defaultDays, purge) {
    return [
        route('POST', '/v1/admin/retention', async (req, res, params, query) => {
            void params;
            if (!hasAccess(req, token)) {
                sendForbidden(res);
                return;
            }
            const days = parseDays(query.days, defaultDays);
            if (days === null) {
                errorResponse('BAD_REQUEST', 'days must be a positive integer', 400).send(res);
                return;
            }
            const body = await purge(pool, days);
            jsonResponse(body).send(res);
        })
    ];
}
