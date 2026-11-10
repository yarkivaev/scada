import metricsRelation, { annotatedPoints, legacyChartRelation, rawMetricsRelation } from './metricsRelation.js';

function missing(error, name) {
    return String(error.code) === '60' && String(error.message).includes(name);
}
function missingNative(error) {
    return ['metrics_points_v4','metrics_state_v4'].some((name) => { return missing(error,name); });
}
async function query(client, sql, params) {
    const result = await client.query({ query: sql, query_params: params, format: 'JSONEachRow' });
    return result.json();
}
function densityChecks(sql) {
    const checks = new Map();
    let cleaned = sql;
    for (const [marker, encoded] of sql.matchAll(/\/\*scada-density-range:(?<encoded>[^*]+)\*\//gu)) {
        cleaned = cleaned.replaceAll(marker,'');
        if (!checks.has(encoded)) {
            const {since,until,gap} = JSON.parse(decodeURIComponent(encoded));
            checks.set(encoded,`SELECT DISTINCT topic FROM (${annotatedPoints(since,until)})
                WHERE (empty({scadaDensityTopics:Array(String)}) OR topic IN {scadaDensityTopics:Array(String)})
                AND (valid_certificate OR (compactable AND island_n>2)) AND first_ts<last_ts
                ${gap === undefined ? '' : `AND max_gap_ms>(${gap})`}
                AND toUnixTimestamp64Milli(first_ts)<=(${until}) AND toUnixTimestamp64Milli(last_ts)>=(${since})`);
        }
    }
    return {cleaned,checks:[...checks.values()]};
}
async function density(client, sql, params) {
    const {cleaned,checks} = densityChecks(sql);
    if (!checks.length) { return cleaned; }
    // One bounded request protects all ranges; serial checks could outlive cleanup grace.
    let unavailable;
    try {
        unavailable = await query(client,`/*scada-density-check*/SELECT topic FROM (${checks.join(' UNION ALL ')}) LIMIT 1`,
            {...params,scadaDensityTopics:params.topics ?? (params.topic ? [params.topic] : [])});
    } catch (error) {
        if (!missingNative(error)) { throw error; }
        return cleaned;
    }
    if (unavailable.length) {
        const error = new Error('Exact sample density is unavailable in sealed compacted history; use canonical values or persisted classifications');
        Object.assign(error,{code:'SCADA_HISTORY_DENSITY_UNAVAILABLE',status:409,statusCode:409});
        throw error;
    }
    return cleaned;
}
async function legacyCompatible(client) {
    const old = await query(client, "SELECT name FROM system.tables WHERE database='scada' AND name IN ('metrics_points_v3','metrics_state_v3','metrics_rejected_v3','metrics_canonical','metrics_compact_v2')", {});
    if (old.some(row=>{return typeof row.name==='string';})) {
        throw new Error('Previous canonical storage requires an explicit v4 migration; native gap evidence is unavailable');
    }
}
/** Read-only upgrades precede writer installation; only absent additive schema falls back. */
export default async function metricsQuery(client, sql, params) {
    const checked = await density(client,sql.replace(/\bscada\.metrics_raw_read\b/giu,rawMetricsRelation).replace(/\bscada\.metrics_read\b/giu,metricsRelation),params);
    try { return await query(client, checked, params); }
    catch (error) {
        for (const [name, relation] of [['metrics_raw_read',rawMetricsRelation],['metrics_read',metricsRelation]]) {
            const pattern = new RegExp(`\\bscada\\.${name}\\b`, 'giu');
            if (missing(error,name) && pattern.test(checked)) { return metricsQuery(client,checked.replace(pattern,relation),params); }
        }
        if (missingNative(error)) {
            let legacy = checked.replace(/\/\*scada-native-chart-range\*\/[\s\S]*?\/\*end-scada-native-chart-range\*\//gu, legacyChartRelation).replace(/\/\*scada-native-range\*\/[\s\S]*?\/\*end-scada-native-range\*\//gu, 'scada.metrics');
            for (const relation of [rawMetricsRelation, metricsRelation]) { legacy = legacy.replaceAll(relation, 'scada.metrics'); }
            if (legacy !== checked) { await legacyCompatible(client); return query(client, legacy, params); }
        }
        throw error;
    }
}
