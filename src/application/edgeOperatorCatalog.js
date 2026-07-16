import operators from '../infrastructure/operators/operators.js';
import centralOperators from '../infrastructure/operators/centralOperators.js';
import operatorsSync from '../infrastructure/operators/operatorsSync.js';
import edgeOperators from '../infrastructure/operators/edgeOperators.js';
import stateHttpClient from '../infrastructure/http/edge/stateHttpClient.js';
import operatorRoute from '../infrastructure/http/plant/routes/operatorRoute.js';

const DEFAULT_SYNC_INTERVAL_SEC = 30;

function syncIntervalMs(env) {
    const sec = parseInt(env.OPERATORS_SYNC_INTERVAL_SEC || String(DEFAULT_SYNC_INTERVAL_SEC), 10);
    if (!Number.isFinite(sec) || sec <= 0) {
        return DEFAULT_SYNC_INTERVAL_SEC * 1000;
    }
    return sec * 1000;
}

/**
 * Edge operator catalog: in-memory cache, periodic central sync, plant routes.
 * POST create proxies to central and refreshes cache; registration flag is read from cache.
 * Without CENTRAL_PLANT_URL create fails fast; first boot yields an empty list until sync.
 *
 * @param {string} basePath - plant API base path
 * @param {object} env - process environment
 * @returns {object} routes array and optional sync job
 *
 * @example
 *   edgeOperatorCatalog('/api/v1', process.env);
 */
export default function edgeOperatorCatalog(basePath, env) {
    const cache = operators();
    const centralUrl = env.CENTRAL_PLANT_URL;
    if (!centralUrl) {
        const provider = edgeOperators(cache, undefined);
        return { routes: operatorRoute(basePath, provider), sync: undefined, provider };
    }
    const client = stateHttpClient({
        baseUrl: centralUrl,
        token: env.CENTRAL_PLANT_TOKEN
    });
    const source = centralOperators(client, basePath);
    const provider = edgeOperators(cache, source);
    const sync = operatorsSync(source, cache, { intervalMs: syncIntervalMs(env) });
    return { routes: operatorRoute(basePath, provider), sync, provider };
}
