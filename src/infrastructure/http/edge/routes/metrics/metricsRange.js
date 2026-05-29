import { hasAccess, sendForbidden } from '../../stateAccess.js';
import { errorResponse, jsonResponse } from '@yarkivaev/simple-server';

/**
 * Downsampled metric range (same date_bin semantics as postgresSensor.measurements).
 *
 * @param {string|null} token - optional bearer token
 * @param {object} metrics - metrics state port
 * @returns {function} route handler
 */
export default function metricsRange(token, metrics) {
    return async (req, res, params, query) => {
        void params;
        if (!hasAccess(req, token)) {
            sendForbidden(res);
            return;
        }
        if (!query.topic || !query.start || !query.end) {
            errorResponse('BAD_REQUEST', 'topic start and end query parameters are required', 400).send(res);
            return;
        }
        const stepMs = parseInt(query.stepMs || '60000', 10);
        const items = await metrics.rangeForTopic(query.topic, query.start, query.end, stepMs);
        jsonResponse({ items }).send(res);
    };
}
