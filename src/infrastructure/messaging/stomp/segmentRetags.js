import { stompSend } from '@yarkivaev/source-to-sink';

const DEFAULT_DESTINATION = '/exchange/scada.segments';

/**
 * Publishes operator retag envelopes to the segments exchange.
 *
 * @param {object} config - publisher configuration
 * @param {string} config.stompUrl - STOMP broker URL
 * @param {string} [config.destination] - STOMP destination
 * @param {string} [config.login] - STOMP login
 * @param {string} [config.passcode] - STOMP passcode
 * @param {string} [config.host] - STOMP vhost header
 * @returns {object} publisher with publish(body)
 *
 * @example
 *   const retags = segmentRetags({ stompUrl });
 *   await retags.publish(retagBody('icht1', row, ['to_ladle'], {}));
 */
export default function segmentRetags(config) {
    if (!config.stompUrl) {
        throw new Error('stompUrl is required for segment retag publisher');
    }
    const destination = config.destination || DEFAULT_DESTINATION;
    const stompOptions = {
        login: config.login,
        passcode: config.passcode,
        host: config.host
    };
    return {
        async publish(body) {
            await stompSend(config.stompUrl, destination, body, stompOptions);
        }
    };
}
