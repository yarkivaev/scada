import schedule from './schedule.js';
import periodicReconciliation from './periodicReconciliation.js';
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
    return periodicReconciliation(() => { return reconcile(store, nodeId, options); }, { intervalMs, onError });
}
