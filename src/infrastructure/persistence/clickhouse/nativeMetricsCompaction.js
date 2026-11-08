import nativeMetricsInsert from './nativeMetricsInsert.js';
import nativeMetricsClock from './nativeMetricsClock.js';
import {effectiveNativePoints,nativeMetricCertificateMatches,OBSOLETE_NATIVE_POINT_SQL} from './nativeMetricPoints.js';
/** One shared definition of window overlap for reads and physical cleanup. */
export function nativeMetricWindows(sourceSql=effectiveNativePoints()) {
    return `SELECT *,ifNull(window_start<prior_end,0) OR ifNull(window_start+window_ms>next_start,0) AS overlap
    FROM (SELECT *,maxOrNull(window_start+window_ms) OVER (PARTITION BY topic ORDER BY window_start,window_ms,compact_ms ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_end,
        minOrNull(window_start) OVER (PARTITION BY topic ORDER BY window_start,window_ms,compact_ms ROWS BETWEEN 1 FOLLOWING AND 1 FOLLOWING) AS next_start
    FROM (SELECT topic,compact_ms,toInt64(floor(toUnixTimestamp64Milli(ts)/toFloat64(if(compact_ms=0,60000,compact_ms))))*toInt64(if(compact_ms=0,60000,compact_ms)) AS window_start,
        toInt64(if(compact_ms=0,60000,compact_ms)) AS window_ms,min(toUnixTimestamp64Milli(ts)) AS first_ms,max(toUnixTimestamp64Milli(ts)) AS last_ms,
        min(value) AS low,max(value) AS high,count() AS n
        FROM (${sourceSql}) GROUP BY topic,compact_ms,window_start,window_ms))`;
}
/** Only entirely closed, equal windows without policy or legacy overlaps qualify. */
export const NATIVE_COMPACTION_WINDOWS_SQL=`WITH spans AS (${nativeMetricWindows()}),
legacy AS (SELECT topic,min(toUnixTimestamp64Milli(ts)) AS first_ms,max(toUnixTimestamp64Milli(ts)) AS last_ms,count() AS n FROM scada.metrics GROUP BY topic)
SELECT a.topic AS topic,a.window_start AS window_start,a.window_ms AS window_ms,a.first_ms AS first_ms,a.last_ms AS last_ms,a.low AS value,a.compact_ms AS compact_ms,state.committed_seq AS committed_seq,
    state.published_at AS published_at
FROM spans a INNER JOIN (SELECT key,closed_before,published_at,committed_seq FROM scada.metrics_state_v3 FINAL) AS state ON state.key=concat('topic:',a.topic)
LEFT JOIN legacy l ON l.topic=a.topic
WHERE a.compact_ms>0 AND a.low=a.high AND a.n>2 AND NOT a.overlap AND a.window_start+a.window_ms<=state.closed_before
    AND NOT(l.n>0 AND a.window_start<=l.last_ms AND a.window_start+a.window_ms>l.first_ms)`;

function endpointRows(windows,publishedAt) {
    return windows.flatMap(window=>{
        const common={topic:window.topic,value:window.value,compact_ms:window.compact_ms,
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
    await client.command({query:`ALTER TABLE scada.metrics_points_v3 DELETE WHERE ${predicates.join(' OR ')}`,query_params:queryParams,clickhouse_settings:{mutations_sync:1}});
}
async function pendingMutations(client) {
    const pending=await client.query({query:"SELECT count() AS n FROM system.mutations WHERE database='scada' AND table='metrics_points_v3' AND NOT is_done",format:'JSONEachRow'});
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
