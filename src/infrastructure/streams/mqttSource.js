import mqtt from 'mqtt';
import positive from './positive.js';
import deadline from './deadline.js';
import budgetAccept from './budgetAccept.js';

function report(options, error) {
    try { options.onError?.(error); } catch {
        // Diagnostics cannot break transport callbacks.
    }
}
function bind(live, collector, options) {
    live.client.on('error', (error) => { report(options, error); });
    for (const event of ['offline', 'close']) {
        live.client.on(event, () => {
            if (live.active) { report(options, new Error('MQTT source disconnected')); }
        });
    }
    // MQTT.js serializes handleMessage and sends PUBACK/PUBCOMP only on successful completion.
    live.client.handleMessage = (packet, callback) => {
        const accepted = Promise.resolve().then(() => {
            if (!live.active) { throw new Error('MQTT source stopped'); }
            return budgetAccept(collector, { topic: packet.topic, payload: packet.payload.toString() }, packet.payload.length, options, { signal: live.controller.signal });
        });
        live.pending.add(accepted);
        void accepted.finally(() => { live.pending.delete(accepted); }).catch(() => { return undefined; });
        deadline(accepted, options.acceptTimeoutMs, 'MQTT acceptance', (error) => {
            live.active = false; live.controller.abort(error); live.client.end(true);
        }).then(() => {
            callback(live.active ? undefined : new Error('MQTT source stopped'));
        }, (error) => { callback(error); report(options, error); });
    };
}
function open(url, list, collector, options) {
    const client = (options.connect || mqtt.connect)(url, {
        ...options.connectionOptions, clientId: options.clientId, clean: !options.clientId, protocolVersion: 5,
        properties: { sessionExpiryInterval: options.clientId ? options.sessionExpiryInterval ?? 3600 : 0,
            receiveMaximum: options.prefetch ?? 32, maximumPacketSize: options.maxPacketBytes ?? 1048576 }
    });
    const live = { client, active: true, pending: new Set(), controller: new AbortController() };
    bind(live, collector, options);
    client.on('connect', () => {
        if (live.active) {
            client.subscribe(list, { qos: options.qos ?? (options.clientId ? 1 : 0) }, (error, granted) => {
                if (!live.active) { return; }
                if (error || granted?.some((entry) => { return entry.qos >= 128; })) {
                    report(options, error ?? new Error('MQTT subscription denied')); return;
                }
                try { options.onReady?.(); } catch {
                    // Diagnostics cannot break transport callbacks.
                }
            });
        }
    });
    return live;
}
/** ACK follows asynchronous acceptance, not merely receipt. Acceptance is not necessarily durable. */
export default function mqttSource(url, topics, collector, options = {}) {
    if (typeof url !== 'string' || !url) { throw new Error('URL must be a non-empty string'); }
    if (typeof topics !== 'string' || !topics.trim()) { throw new Error('Topic must be a non-empty string'); }
    if (typeof collector?.accept !== 'function') { throw new Error('Collector must have an accept() method'); }
    const config = { acceptTimeoutMs: 10000, stopTimeoutMs: 5000, ...options };
    positive(config.acceptTimeoutMs, 'acceptTimeoutMs');
    positive(config.stopTimeoutMs, 'stopTimeoutMs');
    const list = topics.split(',').map((topic) => { return topic.trim(); }).filter(Boolean);
    let live;
    return {
        start() {
            if (!live) { live = open(url, list, collector, config); }
        },
        stop() {
            if (!live) { return Promise.resolve(); }
            const stopped = live;
            stopped.active = false;
            stopped.controller.abort(new Error('MQTT source stopped'));
            const closing = new Promise((resolve) => { stopped.client.end(true, {}, resolve); });
            return deadline(Promise.all([closing, ...stopped.pending]), config.stopTimeoutMs, 'MQTT stop').then(() => {
                if (live === stopped) { live = undefined; }
            });
        }
    };
}
