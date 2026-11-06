/** A fenced subscription reports failure once and cannot be revived by late callbacks. */
export default function stompLifecycle(settings, channel, destination) {
    const state = { ...settings, active: true, fatal: null, phase: 'starting', connected: false,
        controller: new AbortController(), pending: new Set(), bytes: 0, closed: false };
    function notify(callback, value) {
        try { callback?.(value); } catch {
            // An observer cannot interrupt transport fencing or broker callbacks.
        }
    }
    function close() {
        if (!state.closed) { state.closed = true; channel.close(); }
    }
    function report(error) {
        if (settings.onError) { notify(settings.onError, error); }
        else { process.stderr.write(`STOMP source ${destination}: ${error.message}\n`); }
    }
    return Object.assign(state, {
        transition(phase) {
            if (!state.active || state.fatal) { return; }
            state.phase = phase;
            if (phase === 'running') { state.connected = true; }
            notify(settings.onState, { state: phase });
        },
        fail(error) {
            if (!state.active || state.fatal) { return; }
            state.fatal = error;
            state.active = false;
            state.phase = 'failed';
            state.controller.abort(error);
            close();
            report(error);
            notify(settings.onState, { state: 'failed', reason: error.message });
            notify(settings.onFatal, error);
        },
        report(error) {
            if (state.active && error !== state.fatal) { report(error); }
        },
        halt() {
            state.active = false;
            state.controller.abort(new Error('STOMP source stopped'));
            if (!state.fatal) { state.phase = 'stopped'; }
            close();
        },
        health() { return { state: state.phase, reason: state.fatal?.message ?? null }; }
    });
}
