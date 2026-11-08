/** States retain source timestamps once, as compact bitmaps, without a PG index. */
const STATES = `SELECT topic,bucket_start,bucket_ms,thin_ms,value,groupBitmapMergeState(stamps) AS stamps
    FROM scada.metrics_compact_v2 GROUP BY topic,bucket_start,bucket_ms,thin_ms,value`;
// Logical output windows are independent of the fixed physical minute grid.
const LOGICAL_STATES = `SELECT topic,logical_start AS bucket_start,logical_ms AS bucket_ms,thin_ms,value,
    groupBitmapState(toUInt64(original_ms-logical_start)) AS stamps
FROM (SELECT topic,thin_ms,value,original_ms,logical_ms,
    toInt64(floor(original_ms/toFloat64(logical_ms)))*toInt64(logical_ms) AS logical_start
    FROM (SELECT topic,thin_ms,value,bucket_start+toInt64(arrayJoin(bitmapToArray(stamps))) AS original_ms,
        if(thin_ms=0,toUInt64(60000),thin_ms) AS logical_ms FROM (${STATES})))
GROUP BY topic,logical_start,logical_ms,thin_ms,value`;
const ADAPTIVE = `WITH states AS (${LOGICAL_STATES}), spans AS (
    SELECT topic,bucket_start,bucket_ms,thin_ms FROM states GROUP BY topic,bucket_start,bucket_ms,thin_ms
), adjacent AS (
    SELECT *,maxOrNull(bucket_start+toInt64(bucket_ms)) OVER (PARTITION BY topic ORDER BY bucket_start,bucket_ms,thin_ms
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_end,
        minOrNull(bucket_start) OVER (PARTITION BY topic ORDER BY bucket_start,bucket_ms,thin_ms
        ROWS BETWEEN 1 FOLLOWING AND 1 FOLLOWING) AS next_start FROM spans
), legacy AS (
    SELECT topic,min(toUnixTimestamp64Milli(ts)) AS first_ms,max(toUnixTimestamp64Milli(ts)) AS last_ms,count() AS n
    FROM scada.metrics GROUP BY topic
)
SELECT states.topic AS topic,states.bucket_start AS bucket_start,states.bucket_ms AS bucket_ms,
    states.thin_ms AS thin_ms,states.value AS value,states.stamps AS stamps,
    count() OVER (PARTITION BY states.topic,states.bucket_start,states.bucket_ms,states.thin_ms) AS variants,
    ifNull(bucket_start<prior_end,0) OR ifNull(bucket_start+toInt64(bucket_ms)>next_start,0)
        OR (legacy.n>0 AND bucket_start<=legacy.last_ms AND bucket_start+toInt64(bucket_ms)>legacy.first_ms) AS overlap
FROM states INNER JOIN adjacent USING(topic,bucket_start,bucket_ms,thin_ms)
LEFT JOIN legacy USING(topic)`;
export const COMPACT_POINTS_SQL = `SELECT topic,
    fromUnixTimestamp64Milli(bucket_start + toInt64(arrayJoin(
        if(thin_ms=0 OR variants>1 OR overlap,bitmapToArray(stamps),arrayDistinct([bitmapMin(stamps),bitmapMax(stamps)]))
    ))) AS ts,value FROM (${ADAPTIVE})`;
export const COMPACT_RAW_POINTS_SQL = `SELECT topic,
    fromUnixTimestamp64Milli(bucket_start+toInt64(arrayJoin(bitmapToArray(stamps)))) AS ts,value FROM (${STATES})`;
function relation(points) {
    return `(SELECT topic,ts,argMin(value,priority) AS value FROM (
        SELECT topic,ts,value,0 AS priority FROM scada.metrics
        UNION ALL SELECT topic,ts,value,1 AS priority FROM (${points})
    ) GROUP BY topic,ts)`;
}
/** Density-sensitive analytics reconstruct every canonical source timestamp. */
export const rawMetricsRelation = relation(COMPACT_RAW_POINTS_SQL);
/** Adaptive reads preserve endpoints or every point in mixed/overlapping windows. */
export default relation(COMPACT_POINTS_SQL);

/** SQL expressions must be static placeholders, never interpolated user input. */
export function rawMetricsRange(sinceSql,untilSql) {
    const bounded = STATES.replace('FROM scada.metrics_compact_v2 GROUP BY',
        `FROM scada.metrics_compact_v2 WHERE bucket_start<=(${untilSql}) AND bucket_start+toInt64(bucket_ms)>(${sinceSql}) GROUP BY`);
    return `/*scada-raw-range*/${relation(COMPACT_RAW_POINTS_SQL.replace(STATES,bounded))}/*end-scada-raw-range*/`;
}
