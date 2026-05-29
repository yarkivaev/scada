import metricsSensor from '../../persistence/metricsSensor.js';
import httpMetricsRead from './httpMetricsRead.js';

/**
 * Sensor reading metrics via supervisor-sink HTTP API.
 *
 * @param {object} client - stateHttpClient
 * @param {string} topic - metrics topic key
 * @param {string} displayName - label
 * @param {string} unit - unit string
 * @returns {object} sensor with name current measurements stream
 */
export default function stateHttpMetricsSensor(client, topic, displayName, unit) {
    return metricsSensor(httpMetricsRead(client), topic, displayName, unit);
}
