import metricsRelation, { rawMetricsRelation } from './metricsRelation.js';

function missing(error, name) {
    return String(error.code) === '60' && String(error.message).includes(name);
}
async function query(client, sql, params) {
    const result = await client.query({ query: sql, query_params: params, format: 'JSONEachRow' });
    return result.json();
}
/** Read-only upgrades precede writer schema creation; only missing additive schema falls back. */
export default async function metricsQuery(client, sql, params) {
    try { return await query(client, sql, params); }
    catch (error) {
        for (const [name, relation] of [['metrics_raw_read',rawMetricsRelation],['metrics_read',metricsRelation]]) {
            const pattern = new RegExp(`\\bscada\\.${name}\\b`, 'giu');
            if (missing(error,name) && pattern.test(sql)) { return metricsQuery(client,sql.replace(pattern,relation),params); }
        }
        if (missing(error,'metrics_compact_v2')) {
            let legacy = sql.replace(/\/\*scada-raw-range\*\/[\s\S]*?\/\*end-scada-raw-range\*\//gu, 'scada.metrics');
            for (const relation of [rawMetricsRelation, metricsRelation]) { legacy = legacy.replaceAll(relation, 'scada.metrics'); }
            if (legacy !== sql) { return query(client, legacy, params); }
        }
        throw error;
    }
}
