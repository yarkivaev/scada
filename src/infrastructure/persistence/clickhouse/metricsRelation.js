import { nativeMetricWindows } from './nativeMetricsCompaction.js';
import { effectiveNativePoints } from './nativeMetricPoints.js';

/** Ordinary native point rows. Never reconstruct or invent deleted observations. */
export const MAX_COMPACT_WINDOW_MS = 3600000;
function physical(since, until, expand = false) {
    const bounds = since === undefined ? '' : ` WHERE ts>=fromUnixTimestamp64Milli((${since})-${expand ? MAX_COMPACT_WINDOW_MS : 0}) AND ts<=fromUnixTimestamp64Milli((${until})+${expand ? MAX_COMPACT_WINDOW_MS : 0})`;
    return `SELECT topic,ts,value,compact_ms,revision,is_compacted,compact_first,compact_last,compacted_at FROM scada.metrics_points_v3 FINAL${bounds}`;
}
function stored(since,until,expand=false) {
    return effectiveNativePoints(physical(since,until,expand),physical(since,until,true));
}
/** Full windows are required before deciding that a window is constant. */
export function annotatedPoints(since, until) {
    const source = stored(since, until, true);
    return `SELECT points.topic AS topic,points.ts AS ts,points.value AS value,points.compact_ms AS compact_ms,points.revision AS revision,
        fromUnixTimestamp64Milli(w.first_ms) AS first_ts,fromUnixTimestamp64Milli(w.last_ms) AS last_ts,
        w.compact_ms>0 AND NOT w.overlap AND ifNull(state.state_exists,0)=1
            AND w.window_start+w.window_ms<=state.closed_before AND w.low=w.high
            AND NOT (legacy.n>0 AND w.window_start<=legacy.last_ms AND w.window_start+w.window_ms>legacy.first_ms) AS compactable
        FROM (${source}) AS points
        INNER JOIN (${nativeMetricWindows(source)}) AS w ON points.topic=w.topic AND points.compact_ms=w.compact_ms
            AND toInt64(floor(toUnixTimestamp64Milli(points.ts)/toFloat64(if(points.compact_ms=0,60000,points.compact_ms))))
                *toInt64(if(points.compact_ms=0,60000,points.compact_ms))=w.window_start
        LEFT JOIN (SELECT key,closed_before,1 AS state_exists FROM scada.metrics_state_v3 FINAL WHERE key!='') AS state
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
/** Canonical chart/transition range, retaining complete policy windows for classification. */
export function metricsRange(since, until) {
    return `/*scada-native-range*/${relation(adaptive(since, until))}/*end-scada-native-range*/`;
}
/** Density-sensitive reads must be checked before issuing the point-count/gap query. */
export function rawMetricsRange(since, until) {
    const guard = encodeURIComponent(JSON.stringify({ since, until }));
    return `/*scada-density-range:${guard}*//*scada-native-range*/${relation(`SELECT topic,ts,value FROM (${stored(since, until)})`)}/*end-scada-native-range*/`;
}

/** Derived display boundary vertices cover a clipped constant span; these are not raw observations. */
export function chartMetricsRange(since,until) {
    const points = `${adaptive(since,until)} UNION ALL SELECT cover.topic AS topic,
        fromUnixTimestamp64Milli(arrayJoin(arrayDistinct([
            greatest(toUnixTimestamp64Milli(cover.first_ts),toInt64(${since})),
            least(toUnixTimestamp64Milli(cover.last_ts),toInt64(${until}))]))) AS ts,cover.value AS value
        FROM (${annotatedPoints(since,until)}) AS cover WHERE cover.compactable AND cover.ts=cover.first_ts
            AND toUnixTimestamp64Milli(cover.first_ts)<=(${until}) AND toUnixTimestamp64Milli(cover.last_ts)>=(${since})`;
    return `/*scada-native-range*/${relation(points)}/*end-scada-native-range*/`;
}
