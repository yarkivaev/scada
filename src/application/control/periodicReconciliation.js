/** Run one reconciliation at a time, starting immediately. */
export default function periodicReconciliation(run, { intervalMs, onError }) {
    const state = { stopped: false, pending: null };
    function tick() {
        if (state.stopped) { return state.pending; }
        state.pending ??= Promise.resolve().then(run).catch(onError).finally(() => { state.pending = null; });
        return state.pending;
    }
    const timer = setInterval(() => { void tick(); }, intervalMs);
    void tick();
    return {
        tick,
        async stop() {
            state.stopped = true;
            clearInterval(timer);
            await state.pending;
        }
    };
}
