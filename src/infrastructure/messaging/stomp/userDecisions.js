import { stompSend } from '@yarkivaev/source-to-sink';
import userDecisionBody from './userDecisionBody.js';

const DEFAULT_DESTINATION = '/exchange/scada.user_decisions';

/**
 * Publishes operator tag decisions to RabbitMQ for Scala supervisor.
 *
 * @param {object} config - publisher configuration
 * @param {string} config.stompUrl - STOMP broker URL
 * @param {string} [config.destination] - STOMP destination
 * @param {string} [config.login] - STOMP login
 * @param {string} [config.passcode] - STOMP passcode
 * @param {string} [config.host] - STOMP vhost header
 * @returns {object} publisher with publish(machine, start, tags, properties, audit)
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
    return {
        /**
         * Publishes one operator decision to STOMP.
         *
         * @param {string} machine - machine id
         * @param {Date} start - segment start
         * @param {string[]} tags - selected tags
         * @param {object} properties - segment properties
         * @param {object} audit - id, displayName, decidedAt
         */
        async publish(machine, start, tags, properties, audit) {
            const body = userDecisionBody(machine, start, tags, properties, audit);
            await stompSend(config.stompUrl, destination, body, stompOptions);
        }
    };
}
