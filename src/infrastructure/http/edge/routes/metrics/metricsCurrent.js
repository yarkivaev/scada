import { hasAccess, sendForbidden } from '../../stateAccess.js';
import { errorResponse, jsonResponse } from '@yarkivaev/simple-server';

/**
 * Latest metric row for a topic (same semantics as postgresSensor.current).
 *
 * @param {string|null} token - optional bearer token
 * @param {object} metrics - metrics state port
 * @returns {function} route handler
 */
export default function metricsCurrent(token, metrics) {
    return async (req, res, params, query) => {
        void params;
        if (!hasAccess(req, token)) {
            sendForbidden(res);
            return;
        }
        if (!query.topic) {
            errorResponse('BAD_REQUEST', 'topic query parameter is required', 400).send(res);
            return;
        }
        const row = await metrics.latestForTopic(query.topic);
        if (!row) {
            jsonResponse({ found: false }).send(res);
            return;
        }
        jsonResponse({ found: true, ts: row.ts, value: row.value }).send(res);
    };
}
