import stompit from 'stompit';
import deadline from './deadline.js';
import positive from './positive.js';

/**
 * Builds STOMP connect options from a URL.
 *
 * @param {URL} parsed - Parsed URL object
 * @param {object} options - Connection options
 * @returns {object} stompit connect parameters
 */
/**
 * STOMP SEND headers that persist the body on a durable RabbitMQ queue.
 *
 * @param {string} destination - STOMP destination
 * @returns {object} headers including persistent true
 */
export function stompHeaders(destination) {
    return {
        destination,
        'content-type': 'application/json',
        persistent: 'true'
    };
}

function connectParams(parsed, options) {
    return {
        host: parsed.hostname,
        port: parseInt(parsed.port, 10) || 61613,
        connectHeaders: {
            host: options.host || parsed.hostname,
            login: options.login || '',
            passcode: options.passcode || ''
        }
    };
}

/**
 * One-shot STOMP publish of a JSON payload to a destination.
 *
 * Connects, sends one MESSAGE frame, disconnects. For operator decisions
 * and other low-volume outbound events.
 *
 * @example
 * await stompSend('stomp://rabbitmq:61613', '/exchange/scada.user_decisions',
 *   { machine: 'drive2', start: 1700000000, user: 'hmi', tags: ['heating'] },
 *   { login: 'guest', passcode: 'guest', host: '/' });
 *
 * @param {string} url - STOMP broker URL
 * @param {string} destination - STOMP destination
 * @param {object|string} payload - JSON-serializable body or raw string
 * @param {object} [options] - STOMP connection options
 * @param {string} [options.login] - Login
 * @param {string} [options.passcode] - Passcode
 * @param {string} [options.host] - Virtual host header
 * @returns {Promise<void>} Resolves when the frame is sent and client disconnects
 */
export default function stompSend(url, destination, payload, options = {}) {
    if (typeof url !== 'string' || url.length === 0) {
        throw new Error('URL must be a non-empty string');
    }
    if (typeof destination !== 'string' || destination.length === 0) {
        throw new Error('Destination must be a non-empty string');
    }
    const parsed = new URL(url);
    const params = connectParams(parsed, options);
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const timeoutMs = options.timeoutMs ?? 10000;
    positive(timeoutMs, 'timeoutMs');
    const state = { active: true, client: null, connecting: null };
    const sent = new Promise((resolve, reject) => {
        state.connecting = (options.connect || stompit.connect)({ ...params, timeout: timeoutMs }, (error, client) => {
            if (error) { reject(error); return; }
            state.client = client;
            if (!state.active) { client.destroy(); return; }
            client.on('error', reject);
            try {
                const frame = client.send(stompHeaders(destination), { onReceipt() {
                    if (state.active) { client.disconnect((failure) => { if (failure) { reject(failure); } else { resolve(); } }); }
                } });
                frame.end(body);
            } catch (failure) { client.destroy(); reject(failure); }
        });
    });
    return deadline(sent, timeoutMs, 'STOMP receipt/disconnect', () => {
        state.active = false;
        (state.client || state.connecting)?.destroy();
    }).finally(() => { state.active = false; });
}
