import nativeMetricsInsert from './nativeMetricsInsert.js';
import nativeMetricsClock from './nativeMetricsClock.js';
import {effectiveNativePoints,nativeMetricCertificateMatches,OBSOLETE_NATIVE_POINT_SQL} from './nativeMetricPoints.js';
/** One shared definition of window overlap for reads and physical cleanup. */
export function nativeMetricWindows(sourceSql=effectiveNativePoints()) {
    return `SELECT *,ifNull(window_start<prior_end,0) OR ifNull(window_start+window_ms>next_start,0) AS overlap
    FROM (SELECT *,maxOrNull(window_start+window_ms) OVER (PARTITION BY topic ORDER BY window_start,window_ms,compact_ms,max_gap_ms ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_end,
        minOrNull(window_start) OVER (PARTITION BY topic ORDER BY window_start,window_ms,compact_ms,max_gap_ms ROWS BETWEEN 1 FOLLOWING AND 1 FOLLOWING) AS next_start
    FROM (SELECT topic,compact_ms,max_gap_ms,toInt64(floor(toUnixTimestamp64Milli(ts)/toFloat64(if(compact_ms=0,60000,compact_ms))))*toInt64(if(compact_ms=0,60000,compact_ms)) AS window_start,
        toInt64(if(compact_ms=0,60000,compact_ms)) AS window_ms,min(toUnixTimestamp64Milli(ts)) AS first_ms,max(toUnixTimestamp64Milli(ts)) AS last_ms,
        min(value) AS low,max(value) AS high,count() AS n
        FROM (${sourceSql}) GROUP BY topic,compact_ms,max_gap_ms,window_start,window_ms))`;
}
/** Full certificates are interval atoms, so deleted density cannot create new gaps. */
export function nativeMetricIslandPoints(sourceSql=effectiveNativePoints()) {
    const policy='topic,compact_ms,max_gap_ms,window_start,window_ms';
    const island=`${policy},island_id`;
    return `SELECT *,countIf(is_compacted=0 AND point_ms>island_first_ms AND point_ms<island_last_ms) OVER (PARTITION BY ${island}) AS raw_interiors
    FROM (SELECT *,min(atom_first) OVER (PARTITION BY ${island}) AS island_first_ms,
        max(atom_last) OVER (PARTITION BY ${island}) AS island_last_ms,count() OVER (PARTITION BY ${island}) AS island_n
    FROM (SELECT *,sum(if(isNull(prior_atom_end),1,atom_first-prior_atom_end>toInt64(max_gap_ms))) OVER
        (PARTITION BY ${policy} ORDER BY atom_first,point_ms ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS island_id
    FROM (SELECT *,maxOrNull(atom_last) OVER (PARTITION BY ${policy} ORDER BY atom_first,point_ms ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_atom_end
    FROM (SELECT *,if(valid_certificate,certificate_first,point_ms) AS atom_first,if(valid_certificate,certificate_last,point_ms) AS atom_last,
        toInt64(if(compact_ms=0,60000,compact_ms)) AS window_ms,
        toInt64(floor(point_ms/toFloat64(if(compact_ms=0,60000,compact_ms))))*toInt64(if(compact_ms=0,60000,compact_ms)) AS window_start
    FROM (SELECT *,is_compacted=1 AND certificate_first<certificate_last AND compact_ms=certificate_compact_ms
        AND max_gap_ms=certificate_max_gap_ms AND value=certificate_value
        AND (point_ms=certificate_first OR point_ms=certificate_last) AS valid_certificate
        FROM (${nativeMetricCertificateMatches(sourceSql,sourceSql)}))))))`;
}
/** One row per policy/window continuity island, after merging all collectors. */
export function nativeMetricIslands(sourceSql=effectiveNativePoints()) {
    return `SELECT topic,compact_ms,max_gap_ms,window_start,window_ms,island_first_ms AS first_ms,island_last_ms AS last_ms,
        max(island_n) AS n,max(raw_interiors) AS raw_interiors FROM (${nativeMetricIslandPoints(sourceSql)})
        GROUP BY topic,compact_ms,max_gap_ms,window_start,window_ms,island_first_ms,island_last_ms`;
}
/** Only entirely closed, equal windows without policy or legacy overlaps qualify. */
export const NATIVE_COMPACTION_WINDOWS_SQL=`WITH spans AS (${nativeMetricWindows()}),islands AS (${nativeMetricIslands()}),
legacy AS (SELECT topic,min(toUnixTimestamp64Milli(ts)) AS first_ms,max(toUnixTimestamp64Milli(ts)) AS last_ms,count() AS n FROM scada.metrics GROUP BY topic)
SELECT a.topic AS topic,a.window_start AS window_start,a.window_ms AS window_ms,i.first_ms AS first_ms,i.last_ms AS last_ms,a.low AS value,a.compact_ms AS compact_ms,a.max_gap_ms AS max_gap_ms,state.committed_seq AS committed_seq,
    state.published_at AS published_at
FROM spans a INNER JOIN islands i ON a.topic=i.topic AND a.compact_ms=i.compact_ms AND a.max_gap_ms=i.max_gap_ms AND a.window_start=i.window_start AND a.window_ms=i.window_ms
INNER JOIN (SELECT key,closed_before,published_at,committed_seq FROM scada.metrics_state_v4 FINAL) AS state ON state.key=concat('topic:',a.topic)
LEFT JOIN legacy l ON l.topic=a.topic
WHERE a.compact_ms>0 AND a.max_gap_ms>0 AND a.low=a.high AND i.n>2 AND i.raw_interiors>0 AND NOT a.overlap AND a.window_start+a.window_ms<=state.closed_before
    AND NOT(l.n>0 AND a.window_start<=l.last_ms AND a.window_start+a.window_ms>l.first_ms)`;

function endpointRows(windows,publishedAt) {
    return windows.flatMap(window=>{
        const common={topic:window.topic,value:window.value,compact_ms:window.compact_ms,max_gap_ms:window.max_gap_ms,
            revision:(BigInt(window.committed_seq)*1024n+1000n).toString(),is_compacted:1,
            compact_first:Number(window.first_ms),compact_last:Number(window.last_ms),compacted_at:publishedAt};
        return [window.first_ms,window.last_ms].map(ts=>{return {...common,ts:new Date(Number(ts)).toISOString().replace('T',' ').slice(0,-1)};});
    });
}
async function deleteObsolete(client,windows) {
    if(!windows.length){return;}
    const queryParams={};
    const predicates=windows.map((window,index)=>{
        queryParams[`topic${index}`]=window.topic;queryParams[`first${index}`]=window.certificate_first;queryParams[`last${index}`]=window.certificate_last;queryParams[`fence${index}`]=window.certificate_fence;
        return `(topic={topic${index}:String} AND ts>fromUnixTimestamp64Milli({first${index}:Int64}) AND ts<fromUnixTimestamp64Milli({last${index}:Int64}) AND revision<={fence${index}:UInt128})`;
    });
    await client.command({query:`ALTER TABLE scada.metrics_points_v4 DELETE WHERE ${predicates.join(' OR ')}`,query_params:queryParams,clickhouse_settings:{mutations_sync:1}});
}
async function pendingMutations(client) {
    const pending=await client.query({query:"SELECT count() AS n FROM system.mutations WHERE database='scada' AND table='metrics_points_v4' AND NOT is_done",format:'JSONEachRow'});
    return Number((await pending.json())[0]?.n??0);
}
/** Certificate publication and physical deletion have separate grace periods. */
export default async function nativeMetricsCompaction(client,options={}) {
    if(await pendingMutations(client)>=(options.maxPendingMutations??1)){return 0;}
    const now=await nativeMetricsClock(client,options);
    const params={mature:now-(options.compactionGraceMs??120000),limit:options.compactionBatchSize??100};
    const obsolete=await client.query({query:`SELECT DISTINCT topic,certificate_first,certificate_last,certificate_fence FROM (${nativeMetricCertificateMatches()}) WHERE ${OBSOLETE_NATIVE_POINT_SQL} AND certificate_at<={mature:Int64} LIMIT {limit:UInt32}`,query_params:params,format:'JSONEachRow'});
    const stale=await obsolete.json();
    await deleteObsolete(client,stale);
    const candidates=await client.query({query:`SELECT * FROM (${NATIVE_COMPACTION_WINDOWS_SQL}) WHERE published_at<={mature:Int64} LIMIT {limit:UInt32}`,query_params:params,format:'JSONEachRow'});
    const windows=await candidates.json();
    if(windows.length){await nativeMetricsInsert(client,endpointRows(windows,await nativeMetricsClock(client,options)));}
    return stale.length+windows.length;
}
