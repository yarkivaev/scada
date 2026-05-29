import metricsBatch from './metricsBatch.js';
import metricsCurrent from './metricsCurrent.js';
import metricsPoll from './metricsPoll.js';
import metricsRange from './metricsRange.js';
import { route } from '@yarkivaev/simple-server';

/**
 * Metrics read/write routes for /v1.
 *
 * @param {string|null} token - optional bearer token
 * @param {object} metrics - metrics state port
 * @returns {Array<object>} route definitions
 */
export default function metricsRoutes(token, metrics) {
    return [
        route('GET', '/v1/metrics/current', metricsCurrent(token, metrics)),
        route('GET', '/v1/metrics/range', metricsRange(token, metrics)),
        route('GET', '/v1/metrics/poll', metricsPoll(token, metrics)),
        route('POST', '/v1/metrics/batch', metricsBatch(token, metrics))
    ];
}
