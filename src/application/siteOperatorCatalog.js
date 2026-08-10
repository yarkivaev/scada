import operatorsFromPg from '../infrastructure/persistence/pg/operators.js';
import userDecisionsFromPg from '../infrastructure/persistence/pg/userDecisions.js';
import operatorRoute from '../infrastructure/http/plant/routes/operatorRoute.js';
import decisionRoute from '../infrastructure/http/plant/routes/decisionRoute.js';
import edgeOperatorCatalog from './edgeOperatorCatalog.js';

/**
 * Central-only operator and user_decisions routes backed by Postgres.
 *
 * @param {string} basePath - plant API base path
 * @param {object} sink - supervisor sink with pool and profile
 * @returns {object} routes, provider, decisions
 */
function centralOperatorRoutes(basePath, sink, owners) {
    if (sink.sinkDbProfile !== 'central') {
        return { routes: [], provider: undefined, decisions: undefined };
    }
    const provider = operatorsFromPg(sink.pool);
    const decisions = userDecisionsFromPg(sink.pool);
    return {
        routes: [
            ...operatorRoute(basePath, provider),
            ...decisionRoute(basePath, decisions, owners)
        ],
        provider,
        decisions
    };
}

/**
 * Resolves operator HTTP catalog for central or edge sink profile.
 *
 * @param {string} basePath - plant API base path
 * @param {object} sink - supervisor sink
 * @param {object} env - process environment
 * @param {object} [owners] - machineOwners registry for edge decision proxy
 * @returns {object} routes, provider, decisions, sync
 *
 * @example
 *   siteOperatorCatalog('/api/v1', sink, process.env, owners);
 */
export default function siteOperatorCatalog(basePath, sink, env, owners) {
    if (sink.sinkDbProfile === 'central') {
        return { ...centralOperatorRoutes(basePath, sink, owners), sync: undefined };
    }
    if (sink.sinkDbProfile === 'edge') {
        const edge = edgeOperatorCatalog(basePath, env);
        if (!sink.pool) {
            return { ...edge, decisions: undefined };
        }
        const decisions = userDecisionsFromPg(sink.pool);
        return {
            ...edge,
            routes: [...edge.routes, ...decisionRoute(basePath, decisions, owners)],
            decisions
        };
    }
    return { routes: [], sync: undefined, provider: undefined, decisions: undefined };
}

/**
 * Picks plant operatorCatalog override or the built-in site catalog.
 *
 * @param {object} config - siteServer config, may include operatorCatalog factory
 * @param {string} basePath - plant API base path
 * @param {object} sink - supervisor sink
 * @param {object} env - process environment
 * @returns {object} routes, provider, decisions, sync
 *
 * @example
 *   buildSiteOperatorCatalog({ operatorCatalog: plantCatalog }, '/api/v1', sink, env);
 */
export function buildSiteOperatorCatalog(config, basePath, sink, env) {
    const factory = config && config.operatorCatalog
        ? config.operatorCatalog
        : siteOperatorCatalog;
    return factory(basePath, sink, env, config && config.owners);
}
