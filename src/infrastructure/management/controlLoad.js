/** Read desired collector placement and node capacity from the quorum store. */
import { clientFromEnv } from '../../application/control/controlClient.js';
import controlStore from '../../application/control/controlStore.js';
import { urlOf } from './protocol.js';

function placement({ catalog, assignments }) {
    if (!Array.isArray(catalog?.nodes) || !Array.isArray(catalog.tasks)) {
        throw new Error('quorum controller has no catalog');
    }
    const costs = new Map(catalog.tasks.map(({ taskId, cost }) => { return [taskId, cost ?? 1]; }));
    return catalog.nodes.flatMap(({ id: resource, capacity }) => {
        const desired = Object.hasOwn(assignments, resource) ? assignments[resource].assignments : undefined;
        const limit = { name: 'capacity', resource, unit: 'cost', value: capacity };
        if (!Array.isArray(desired)) {
            return [{ name: 'assigned-tasks', resource, unit: 'tasks', error: 'no assignment snapshot' }, limit];
        }
        const cost = desired.reduce((total, { taskId }) => { return total + (costs.get(taskId) ?? 1); }, 0);
        return [
            { name: 'assigned-tasks', resource, unit: 'tasks', value: desired.length },
            { name: 'assigned-cost', resource, unit: 'cost', value: cost }, limit
        ];
    });
}

export default function controlLoad({ site, envPrefix, keyPrefix }, env) {
    const endpoints = (env[`${envPrefix}_ENDPOINTS`] ?? '').split(',').filter(Boolean);
    endpoints.forEach((endpoint) => { urlOf(endpoint); });
    const store = controlStore(clientFromEnv(env, envPrefix), keyPrefix);
    return { site, async sample() {
        const view = await store.read().catch(() => { throw new Error('quorum controller read failed'); });
        return placement(view);
    } };
}
