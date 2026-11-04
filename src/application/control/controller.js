import schedule from './schedule.js';
export async function reconcile(store, nodeId, options = {}) {
    const token = await store.acquire(nodeId);
    if (!token) { return false; }
    const view = await store.read();
    if (!view.catalog) { return false; }
    const desired = schedule(view.catalog, view.reports, view.assignments, options);
    return store.commit(token, view, desired);
}
export default function controlLoop(store, nodeId, { intervalMs = 5000, onError = () => {
    // Optional diagnostic sink.
}, ...options } = {}) {
    let stopped = false;
    let pending = null;
    function tick() {
        pending ??= reconcile(store, nodeId, options).catch(onError).finally(() => { pending = null; });
        return pending;
    }
    const timer = setInterval(() => { if (!stopped) { void tick(); } }, intervalMs);
    void tick();
    return { tick, async stop() { stopped = true; clearInterval(timer); await pending; } };
}
