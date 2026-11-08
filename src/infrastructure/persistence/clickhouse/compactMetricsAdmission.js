/** No per-point receipt table: membership is retained in the canonical bitmap. */
export default async function compactMetricsAdmission(client, records) {
    const unique = new Map();
    records.forEach((point) => { const key = JSON.stringify([point.topic, point.ts]); if (!unique.has(key)) { unique.set(key, point); } });
    const points = [...unique.values()];
    if (!points.length) { return; }
    const keys = { keyTopics: points.map(({ topic }) => { return topic; }), keyTimes: points.map(({ ts }) => { return ts; }) };
    const legacy = await client.query({ query: `SELECT topic,toUnixTimestamp64Milli(ts) AS original_ms FROM scada.metrics
        WHERE (topic,toUnixTimestamp64Milli(ts)) IN (SELECT arrayJoin(arrayZip({keyTopics:Array(String)},{keyTimes:Array(Int64)})))`, query_params: keys, format: 'JSONEachRow' });
    const existing = new Set((await legacy.json()).map((point) => { return JSON.stringify([point.topic, Number(point.original_ms)]); }));
    const compact = await client.query({ query: `WITH arrayZip({keyTopics:Array(String)},{keyTimes:Array(Int64)}) AS lookup
        SELECT arrayJoin(arrayFilter(k -> k.1=topic AND k.2>=bucket_start AND k.2<bucket_start+toInt64(bucket_ms)
            AND bitmapContains(stamps,toUInt64(k.2-bucket_start)),lookup)) AS identity
        FROM (SELECT topic,bucket_start,bucket_ms,thin_ms,value,groupBitmapMergeState(stamps) AS stamps
            FROM scada.metrics_compact_v2 WHERE topic IN {topics:Array(String)}
                AND bucket_start<={last:Int64} AND bucket_start+toInt64(bucket_ms)>{first:Int64}
            GROUP BY topic,bucket_start,bucket_ms,thin_ms,value)`, query_params: {
        ...keys, topics: [...new Set(points.map(({ topic }) => { return topic; }))],
        first: Math.min(...points.map(({ ts }) => { return ts; })), last: Math.max(...points.map(({ ts }) => { return ts; }))
    }, format: 'JSONEachRow' });
    (await compact.json()).forEach(({ identity }) => { existing.add(JSON.stringify([identity[0], Number(identity[1])])); });
    const incoming = points.filter(({ topic, ts }) => { return !existing.has(JSON.stringify([topic, ts])); });
    if (!incoming.length) { return; }
    const rows = incoming.map(({ topic, ts, value, thinWindowMs }) => {
        const span = 60000;
        const base = Math.floor(ts / span) * span;
        return [topic, base, span, thinWindowMs, value, ts - base];
    });
    await client.command({ query: `INSERT INTO scada.metrics_compact_v2
        SELECT item.1 AS topic,item.2 AS bucket_start,item.3 AS bucket_ms,item.4 AS thin_ms,item.5 AS value,
            groupBitmapState(item.6) AS stamps
        FROM (SELECT arrayJoin(arrayZip({topics:Array(String)},{bases:Array(Int64)},{spans:Array(UInt64)},
            {windows:Array(UInt64)},{values:Array(Float64)},{offsets:Array(UInt64)})) AS item)
        GROUP BY topic,bucket_start,bucket_ms,thin_ms,value`, query_params: Object.fromEntries(['topics','bases','spans','windows','values','offsets'].map((key,index) => { return [key,rows.map((row) => { return row[index]; })]; })),
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 1 } });
}
