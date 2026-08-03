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
function centralOperatorRoutes(basePath, sink) {
    if (sink.sinkDbProfile !== 'central') {
        return { routes: [], provider: undefined, decisions: undefined };
    }
    const provider = operatorsFromPg(sink.pool);
    const decisions = userDecisionsFromPg(sink.pool);
    return {
        routes: [
            ...operatorRoute(basePath, provider),
            ...decisionRoute(basePath, decisions)
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
 * @returns {object} routes, provider, decisions, sync
 *
 * @example
 *   siteOperatorCatalog('/api/v1', sink, process.env);
 */
export default function siteOperatorCatalog(basePath, sink, env) {
    if (sink.sinkDbProfile === 'central') {
        return { ...centralOperatorRoutes(basePath, sink), sync: undefined };
    }
    if (sink.sinkDbProfile === 'edge') {
        const edge = edgeOperatorCatalog(basePath, env);
        if (!sink.pool) {
            return { ...edge, decisions: undefined };
        }
        const decisions = userDecisionsFromPg(sink.pool);
        return {
            ...edge,
            routes: [...edge.routes, ...decisionRoute(basePath, decisions)],
            decisions
        };
    }
    return { routes: [], sync: undefined, provider: undefined, decisions: undefined };
}
