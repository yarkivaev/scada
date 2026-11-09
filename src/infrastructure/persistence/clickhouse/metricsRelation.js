import { nativeMetricIslandPoints, nativeMetricWindows } from './nativeMetricsCompaction.js';
import { effectiveNativePoints } from './nativeMetricPoints.js';

/** Ordinary native point rows. Never reconstruct or invent deleted observations. */
export const MAX_COMPACT_WINDOW_MS = 3600000;
function physical(since, until, expand = false) {
    const bounds = since === undefined ? '' : ` WHERE ts>=fromUnixTimestamp64Milli((${since})-${expand ? MAX_COMPACT_WINDOW_MS : 0}) AND ts<=fromUnixTimestamp64Milli((${until})+${expand ? MAX_COMPACT_WINDOW_MS : 0})`;
    return `SELECT topic,ts,value,compact_ms,max_gap_ms,revision,is_compacted,compact_first,compact_last,compacted_at FROM scada.metrics_points_v4 FINAL${bounds}`;
}
function stored(since,until,expand=false) {
    return effectiveNativePoints(physical(since,until,expand),physical(since,until,true));
}
/** Full windows and complete certificates classify continuity before range clipping. */
export function annotatedPoints(since, until) {
    const source = stored(since, until, true);
    return `SELECT points.*,
        fromUnixTimestamp64Milli(points.island_first_ms) AS first_ts,fromUnixTimestamp64Milli(points.island_last_ms) AS last_ts,
        w.compact_ms>0 AND w.max_gap_ms>0 AND NOT w.overlap AND ifNull(state.state_exists,0)=1
            AND w.window_start+w.window_ms<=state.closed_before AND w.low=w.high
            AND NOT (legacy.n>0 AND w.window_start<=legacy.last_ms AND w.window_start+w.window_ms>legacy.first_ms) AS compactable
        FROM (${nativeMetricIslandPoints(source)}) AS points
        INNER JOIN (${nativeMetricWindows(source)}) AS w ON points.topic=w.topic AND points.compact_ms=w.compact_ms
            AND points.max_gap_ms=w.max_gap_ms AND points.window_start=w.window_start
        LEFT JOIN (SELECT key,closed_before,1 AS state_exists FROM scada.metrics_state_v4 FINAL WHERE key!='') AS state
            ON state.key=concat('topic:',points.topic)
        LEFT JOIN (SELECT topic,min(toUnixTimestamp64Milli(ts)) AS first_ms,max(toUnixTimestamp64Milli(ts)) AS last_ms,count() AS n
            FROM scada.metrics GROUP BY topic) AS legacy ON legacy.topic=points.topic`;
}
function relation(points) {
    return `(SELECT topic,ts,argMin(value,priority) AS value FROM (
        SELECT topic,ts,value,0 AS priority FROM scada.metrics
        UNION ALL SELECT topic,ts,value,1 AS priority FROM (${points})
    ) GROUP BY topic,ts)`;
}
function adaptive(since, until) {
    return `SELECT topic,ts,value FROM (${annotatedPoints(since, until)}) WHERE NOT compactable OR ts=first_ts OR ts=last_ts`;
}
export const rawMetricsRelation = relation(`SELECT topic,ts,value FROM (${stored()})`);
export default relation(adaptive());
/** Public point ranges retain their three-column contract. */
export function metricsRange(since, until) {
    return `/*scada-native-range*/${relation(adaptive(since, until))}/*end-scada-native-range*/`;
}
export function rawMetricsRange(since, until) {
    const guard = encodeURIComponent(JSON.stringify({ since, until }));
    return `/*scada-density-range:${guard}*//*scada-native-range*/${relation(`SELECT topic,ts,value FROM (${stored(since, until)})`)}/*end-scada-native-range*/`;
}
/** Legacy observations carry no certified coverage or native continuity promise. */
export const legacyChartRelation = `(SELECT topic,ts,value,toUnixTimestamp64Milli(ts) AS coverage_first_ms,
    toUnixTimestamp64Milli(ts) AS coverage_last_ms,toUInt64(30000) AS max_gap_ms,toUInt8(0) AS native FROM scada.metrics)`;
/** Adjacent equal observations certify the short bridge across a storage-window boundary. */
function constantBridges(annotated,since,until) {
    return `SELECT bridge.topic AS topic,fromUnixTimestamp64Milli(arrayJoin(arrayDistinct([
        greatest(prior_ms,toInt64(${since})),least(point_ms,toInt64(${until}))]))) AS ts,
        value,prior_ms AS coverage_first_ms,point_ms AS coverage_last_ms,max_gap_ms,toUInt8(1) AS native
        FROM (SELECT *,lagInFrame(point_ms,1) OVER (PARTITION BY topic ORDER BY ts) AS prior_ms,
            lagInFrame(value,1) OVER (PARTITION BY topic ORDER BY ts) AS prior_value,
            lagInFrame(compact_ms,1) OVER (PARTITION BY topic ORDER BY ts) AS prior_compact_ms,
            lagInFrame(max_gap_ms,1) OVER (PARTITION BY topic ORDER BY ts) AS prior_gap_ms,
            lagInFrame(window_start,1) OVER (PARTITION BY topic ORDER BY ts) AS prior_window_start
            FROM (${annotated})) AS bridge
        LEFT JOIN (SELECT topic,min(toUnixTimestamp64Milli(ts)) AS first_ms,max(toUnixTimestamp64Milli(ts)) AS last_ms,count() AS n
            FROM scada.metrics GROUP BY topic) AS legacy ON legacy.topic=bridge.topic
        WHERE max_gap_ms>0 AND max_gap_ms=prior_gap_ms AND compact_ms=prior_compact_ms
            AND window_start!=prior_window_start AND value=prior_value AND point_ms>prior_ms
            AND point_ms-prior_ms<=toInt64(max_gap_ms) AND prior_ms<=(${until}) AND point_ms>=(${since})
            AND NOT (legacy.n>0 AND prior_ms<=legacy.last_ms AND point_ms>=legacy.first_ms)`;
}
/** Display vertices may clip a constant island, never the silence between islands. */
export function chartMetricsRange(since,until,gap) {
    const annotated=annotatedPoints(since,until);
    const coverage=gap===undefined ? 'compactable' : `compactable AND max_gap_ms<=(${gap})`;
    const columns=`topic,ts,value,if(${coverage},island_first_ms,point_ms) AS coverage_first_ms,if(${coverage},island_last_ms,point_ms) AS coverage_last_ms,max_gap_ms,toUInt8(1) AS native`;
    const points=`SELECT ${columns} FROM (${annotated}) WHERE NOT compactable OR ts=first_ts OR ts=last_ts
        UNION ALL SELECT topic,fromUnixTimestamp64Milli(arrayJoin(arrayDistinct([
            greatest(island_first_ms,toInt64(${since})),least(island_last_ms,toInt64(${until}))]))) AS ts,
            value,island_first_ms AS coverage_first_ms,island_last_ms AS coverage_last_ms,max_gap_ms,toUInt8(1) AS native
        FROM (${annotated}) AS cover WHERE (${coverage}) AND cover.ts=cover.first_ts AND cover.island_first_ms<=(${until}) AND cover.island_last_ms>=(${since})
        ${gap===undefined ? `UNION ALL ${constantBridges(annotated,since,until)}` : ''}`;
    return `/*scada-native-chart-range*/(SELECT topic,ts,
        tupleElement(selected,1) AS value,tupleElement(selected,2) AS coverage_first_ms,
        tupleElement(selected,3) AS coverage_last_ms,tupleElement(selected,4) AS max_gap_ms,tupleElement(selected,5) AS native
        FROM (SELECT topic,ts,argMin(tuple(value,coverage_first_ms,coverage_last_ms,max_gap_ms,native),priority) AS selected FROM (
            SELECT *,0 AS priority FROM ${legacyChartRelation}
            UNION ALL SELECT *,1 AS priority FROM (${points})
        ) GROUP BY topic,ts))/*end-scada-native-chart-range*/`;
}
/** Gap-sensitive coverage is valid only at or above the frozen continuity threshold. */
export function holdsMetricsRange(since,until,gap) {
    const guard=encodeURIComponent(JSON.stringify({since,until,gap}));
    return `/*scada-density-range:${guard}*/${chartMetricsRange(since,until,gap)}`;
}
