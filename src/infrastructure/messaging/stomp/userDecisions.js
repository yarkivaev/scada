import { stompSend } from '@yarkivaev/source-to-sink';
import userDecisionBody from './userDecisionBody.js';

const DEFAULT_DESTINATION = '/exchange/scada.user_decisions';

/**
 * Publishes operator tag decisions to RabbitMQ for Scala supervisor.
 *
 * @param {object} config - publisher configuration
 * @param {string} config.stompUrl - STOMP broker URL
 * @param {string} config.user - operator name for audit
 * @param {string} [config.destination] - STOMP destination
 * @param {string} [config.login] - STOMP login
 * @param {string} [config.passcode] - STOMP passcode
 * @param {string} [config.host] - STOMP vhost header
 * @returns {object} frozen publisher with publish(machine, start, tags, properties)
 */
export default function userDecisions(config) {
    if (!config.stompUrl) {
        throw new Error('stompUrl is required for user decision publisher');
    }
    const destination = config.destination || DEFAULT_DESTINATION;
    const stompOptions = {
        login: config.login,
        passcode: config.passcode,
        host: config.host
    };
    const user = config.user || 'hmi-kiosk';
    return {
        async publish(machine, start, tags, properties) {
            const body = userDecisionBody(machine, start, user, tags, properties);
            await stompSend(config.stompUrl, destination, body, stompOptions);
        }
    };
}
