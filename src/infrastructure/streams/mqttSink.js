import mqtt from 'mqtt';
import positive from './positive.js';
import { connect, publish, terminate } from './mqttSink/session.js';

function settings(options) {
    const config = { qos: 0, maxPending: 1024, maxPendingBytes: 1048576, connectTimeoutMs: 5000, confirmTimeoutMs: 10000, stopTimeoutMs: 5000, ...options };
    ['maxPending', 'maxPendingBytes', 'connectTimeoutMs', 'confirmTimeoutMs', 'stopTimeoutMs'].forEach((key) => { positive(config[key], key); });
    if (!Number.isSafeInteger(config.maxPending)) { throw new TypeError('maxPending must be a safe integer'); }
    if (![0, 1, 2].includes(config.qos)) { throw new TypeError('qos must be 0, 1, or 2'); }
    return config;
}
function write(live, records, signal) {
    if (!live?.ready || live.dead) { throw new Error('Sink is not connected'); }
    if (!Array.isArray(records) || records.some((record) => {
        return !record || typeof record.topic !== 'string' || !record.topic || !(typeof record.payload === 'string' || Buffer.isBuffer(record.payload));
    })) { return Promise.reject(new TypeError('MQTT records require a topic and string/Buffer payload')); }
    if (signal?.aborted) { return Promise.reject(signal.reason || new Error('MQTT publish aborted')); }
    const bytes = records.reduce((total, record) => { return total + Buffer.byteLength(record.payload) + Buffer.byteLength(record.topic); }, 0);
    if (live.bytes + bytes > live.options.maxPendingBytes || live.count + records.length > live.options.maxPending) { return Promise.reject(new Error('MQTT pending capacity exceeded')); }
    live.count += records.length;
    live.bytes += bytes;
    return Promise.all(records.map((record) => {
        if (live.dead) { live.count -= 1; return Promise.reject(new Error('MQTT connection closed')); }
        return publish(live, record, signal);
    })).finally(() => { live.bytes -= bytes; });
}
/** start awaits CONNACK; write awaits publish completion (broker confirmation at QoS 1/2).
 * QoS 0 only confirms local handoff. No automatic replay of uncertain writes.
 */
export default function mqttSink(url, options = {}) {
    if (typeof url !== 'string' || !url) { throw new Error('URL must be a non-empty string'); }
    const config = settings(options);
    let live;
    return {
        start() {
            if (live && !live.dead) { return live.opening; }
            if (live?.dead) { return Promise.reject(new Error('MQTT session retired; create a new sink after stop')); }
            const client = (options.connect || mqtt.connect)(url, {
                ...options.connectionOptions, clientId: options.clientId, protocolVersion: 5,
                reconnectPeriod: 0, queueQoSZero: false, connectTimeout: config.connectTimeoutMs
            });
            live = { client, options: config, pending: new Set(), count: 0, bytes: 0, ready: false, dead: false };
            live.opening = connect(live);
            return live.opening;
        },
        write(records, { signal } = {}) { return write(live, records, signal); },
        stop() {
            const stopped = live;
            if (stopped) { stopped.stopping = true; }
            return (stopped ? terminate(stopped, new Error('MQTT sink stopped')) : Promise.resolve()).then(() => {
                if (live === stopped) { live = undefined; }
            });
        }
    };
}
