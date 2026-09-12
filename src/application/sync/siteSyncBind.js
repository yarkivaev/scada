import { clickhouseSink } from '@yarkivaev/source-to-sink';
import exportQuery from '../export/exportQuery.js';
import scadaClient from '../../infrastructure/client/scadaClient.js';
import { metricsSinkFromPool } from '../../infrastructure/persistence/pg/metrics.js';
import siteSync from './siteSync.js';
import siteSyncSites from './siteSyncSites.js';
import siteSyncTargets from './siteSyncTargets.js';
import syncRoute from '../../infrastructure/http/plant/routes/syncRoute.js';

/**
 * Wires siteSync routes from env, sink persistence, and an optional topic port.
 *
 * @param {object} env - process environment
 * @param {object} sink - supervisor sink with pool and dataAccess
 * @param {object} operations - operations port
 * @param {object} [extras] - topic(machine, key), basePath
 * @returns {object[]} plant extra routes, empty when no sites are configured
 *
 * @example
 *   siteSyncBind(env, sink, ops, { topic, basePath: '/api/v1' });
 */
function fetchWithToken(token) {
    if (!token) {
        return fetch;
    }
    return (url, options) => {
        const headers = { ...(options && options.headers), Authorization: `Bearer ${token}` };
        return fetch(url, { ...options, headers });
    };
}

function metricsOf(sink, env) {
    if (env.SINK_DB_PROFILE !== 'central') {
        return metricsSinkFromPool(sink.pool);
    }
    const url = env.CLICKHOUSE_URL
        || (env.CLICKHOUSE_HOST ? `http://${env.CLICKHOUSE_HOST}:8123` : undefined);
    if (!url) {
        return undefined;
    }
    return clickhouseSink(url, 'scada.metrics');
}

function queryFor(site) {
    return exportQuery(scadaClient(site.url, fetchWithToken(site.token)));
}

export default function siteSyncBind(env, sink, operations, extras) {
    const sites = siteSyncSites(env);
    if (sites.length === 0) {
        return [];
    }
    const extra = extras || {};
    const targets = siteSyncTargets({
        postgres: env.POSTGRES_URL,
        pool: sink.pool,
        operations,
        alerts: sink.dataAccess.alerts,
        metrics: metricsOf(sink, env),
        topic: extra.topic
    });
    const sync = siteSync({ sites, queryFor, targets });
    return syncRoute(extra.basePath || '/api/v1', sync, env.SYNC_TOKEN);
}
