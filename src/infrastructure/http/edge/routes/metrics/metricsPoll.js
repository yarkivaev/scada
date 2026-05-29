import { hasAccess, sendForbidden } from '../../stateAccess.js';
import { errorResponse, jsonResponse } from '@yarkivaev/simple-server';

/**
 * Raw metric rows since a timestamp (postgresSensor.stream polling query).
 *
 * @param {string|null} token - optional bearer token
 * @param {object} metrics - metrics state port
 * @returns {function} route handler
 */
export default function metricsPoll(token, metrics) {
    return async (req, res, params, query) => {
        void params;
        if (!hasAccess(req, token)) {
            sendForbidden(res);
            return;
        }
        if (!query.topic || !query.after || !query.until) {
            errorResponse('BAD_REQUEST', 'topic after and until query parameters are required', 400).send(res);
            return;
        }
        const items = await metrics.pollTopic(query.topic, query.after, query.until);
        jsonResponse({ items }).send(res);
    };
}
