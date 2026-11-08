import deadline from '../deadline.js';

export function terminate(live, error) {
    if (live.dead) { return live.closing; }
    live.dead = true;
    live.ready = false;
    live.pending.forEach((settle) => { settle(error || new Error('MQTT connection closed')); });
    live.closing = deadline(new Promise((resolve) => {
        live.client.end(true, {}, resolve);
    }), live.options.stopTimeoutMs, 'MQTT disconnect');
    // An event callback cannot surface a rejected shutdown. stop() still returns it.
    void live.closing.catch(() => { return undefined; });
    if (!live.stopping) {
        try { live.options.onFatal?.(error || new Error('MQTT connection closed')); } catch {
            // Observability must not prevent closing the retired session.
        }
    }
    return live.closing;
}
export function connect(live) {
    return deadline(new Promise((resolve, reject) => {
        function fail(error) { reject(error); void terminate(live, error); }
        live.client.on('error', fail);
        live.client.on('close', () => { fail(new Error('MQTT connection closed')); });
        live.client.on('offline', () => { fail(new Error('MQTT connection offline')); });
        live.client.on('connect', () => {
            if (!live.dead) { live.ready = true; resolve(); }
        });
        live.pending.add(reject);
    }), live.options.connectTimeoutMs, 'MQTT connect', (error) => { void terminate(live, error); });
}
export function publish(live, record, signal) {
    return new Promise((resolve, reject) => {
        let done = false;
        const timer = { handle: null };
        function abort() { void terminate(live, signal.reason || new Error('MQTT publish aborted')); }
        function settle(error) {
            if (done) { return; }
            done = true;
            clearTimeout(timer.handle);
            signal?.removeEventListener('abort', abort);
            live.pending.delete(settle);
            live.count -= 1;
            if (error) { reject(error); } else { resolve(); }
        }
        timer.handle = setTimeout(() => { void terminate(live, new Error('MQTT confirmation timed out; outcome uncertain')); }, live.options.confirmTimeoutMs);
        live.pending.add(settle);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        try { live.client.publish(record.topic, record.payload, { qos: live.options.qos }, (error) => {
            settle(error);
            if (error) { void terminate(live, error); }
        }); }
        catch (error) { void terminate(live, error); }
    });
}
