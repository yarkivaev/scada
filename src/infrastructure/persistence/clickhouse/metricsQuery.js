import metricsRelation from './metricsRelation.js';

function missing(error, name) {
    return String(error.code) === '60' && String(error.message).includes(name);
}
async function query(client, sql, params) {
    const result = await client.query({ query: sql, query_params: params, format: 'JSONEachRow' });
    return result.json();
}
/**
 * Read-only upgrades can precede schema creation. Retry only a precisely missing
 * additive table/view; permission errors and incompatible schemas remain fatal.
 * Do not cache absence: the next query sees a concurrently installed projection.
 */
export default async function metricsQuery(client, sql, params) {
    try { return await query(client, sql, params); }
    catch (error) {
        if (missing(error, 'metrics_read') && /\bscada\.metrics_read\b/iu.test(sql)) {
            return metricsQuery(client, sql.replace(/\bscada\.metrics_read\b/giu, metricsRelation), params);
        }
        if (missing(error, 'metrics_canonical') && sql.includes(metricsRelation)) {
            return query(client, sql.replaceAll(metricsRelation, 'scada.metrics'), params);
        }
        throw error;
    }
}
