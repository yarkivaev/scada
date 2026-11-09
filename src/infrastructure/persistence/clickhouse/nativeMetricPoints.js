export const NATIVE_PHYSICAL_POINTS_SQL=`SELECT topic,ts,value,compact_ms,max_gap_ms,revision,is_compacted,compact_first,compact_last,compacted_at FROM scada.metrics_points_v4 FINAL`;

/** Two ordinary endpoint rows certify a previously proven constant immutable span. */
export function nativeMetricCertificates(sourceSql=NATIVE_PHYSICAL_POINTS_SQL) {
    return `SELECT topic,compact_first AS first_ms,compact_last AS last_ms,value,
        min(revision) AS fence,max(compacted_at) AS certificate_at,min(compact_ms) AS certificate_compact_ms,min(max_gap_ms) AS certificate_max_gap_ms
    FROM (${sourceSql}) WHERE is_compacted=1
    GROUP BY topic,compact_first,compact_last,value
    HAVING first_ms<last_ms AND uniqExact(ts)=2 AND min(toUnixTimestamp64Milli(ts))=first_ms
        AND max(toUnixTimestamp64Milli(ts))=last_ms AND uniqExact(compact_ms)=1 AND uniqExact(max_gap_ms)=1 AND min(max_gap_ms)>0`;
}
/** Certified spans never overlap, so one indexed predecessor match is sufficient. */
export function nativeMetricCertificateMatches(pointSourceSql=NATIVE_PHYSICAL_POINTS_SQL,certificateSourceSql=NATIVE_PHYSICAL_POINTS_SQL) {
    return `SELECT p.topic AS topic,p.ts AS ts,p.value AS value,p.compact_ms AS compact_ms,p.max_gap_ms AS max_gap_ms,p.revision AS revision,
        p.is_compacted AS is_compacted,p.compact_first AS compact_first,p.compact_last AS compact_last,p.compacted_at AS compacted_at,
        p.point_ms AS point_ms,c.first_ms AS certificate_first,c.last_ms AS certificate_last,c.fence AS certificate_fence,c.certificate_at AS certificate_at,c.certificate_compact_ms AS certificate_compact_ms,c.certificate_max_gap_ms AS certificate_max_gap_ms,c.value AS certificate_value
    FROM (SELECT *,toUnixTimestamp64Milli(ts) AS point_ms FROM (${pointSourceSql})) AS p
    ASOF LEFT JOIN (SELECT * FROM (${nativeMetricCertificates(certificateSourceSql)}) ORDER BY topic,first_ms) AS c
        ON p.topic=c.topic AND p.point_ms>=c.first_ms`;
}
export const OBSOLETE_NATIVE_POINT_SQL='point_ms>certificate_first AND point_ms<certificate_last AND revision<=certificate_fence';
/** A delayed older INSERT cannot resurrect a physically deleted interior winner. */
export function effectiveNativePoints(pointSourceSql=NATIVE_PHYSICAL_POINTS_SQL,certificateSourceSql=NATIVE_PHYSICAL_POINTS_SQL) {
    return `SELECT topic,ts,value,compact_ms,max_gap_ms,revision,is_compacted,compact_first,compact_last,compacted_at
        FROM (${nativeMetricCertificateMatches(pointSourceSql,certificateSourceSql)}) WHERE NOT(${OBSOLETE_NATIVE_POINT_SQL})`;
}
