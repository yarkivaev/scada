/** First registration/new topics import existing durable telemetry before enabling history polling. */
export default async function historyConfigure(client,machine,topics,bucketMs,{retentionDays,observations}) {
    const previous = await client.query('SELECT topic FROM history_topics WHERE machine=$1',[machine]);
    const known = new Set(previous.rows.map((row) => { return row.topic; }));
    await client.query('DELETE FROM history_topics WHERE machine=$1',[machine]);
    for (const item of topics) {
        if (typeof item.topic !== 'string' || !item.topic || typeof item.channel !== 'string' || !item.channel) { throw new TypeError('Invalid history topic'); }
        // eslint-disable-next-line no-await-in-loop
        await client.query('INSERT INTO history_topics(machine,topic,channel,bucket_ms,retention_days) VALUES($1,$2,$3,$4,$5)',[machine,item.topic,item.channel,bucketMs,retentionDays]);
    }
    const added = topics.filter((item) => { return !known.has(item.topic); }).map((item) => { return item.topic; });
    if (observations?.registered) {
        await observations.registered(machine,added,{bucketMs,retentionDays});
    } else if (added.length) {
        await client.query(`WITH imported AS (
            INSERT INTO history_observations(machine,channel,time_ms,event_id,value)
            SELECT $1,t.channel,floor(extract(epoch FROM m.ts)*1000)::bigint,
                md5(m.topic||':'||floor(extract(epoch FROM m.ts)*1000)::bigint::text||':'||m.value::text),m.value
            FROM metrics m JOIN history_topics t ON t.machine=$1 AND t.topic=m.topic
            WHERE m.topic=ANY($2::text[]) AND m.ts>=now()-make_interval(days=>$3)
            ORDER BY m.ts,m.ctid ON CONFLICT DO NOTHING RETURNING time_ms
        ) INSERT INTO history_work(id,machine,from_ms,until_ms)
            SELECT md5($1||':'||(time_ms/$4)::text)::uuid,$1,min(time_ms),max(time_ms) FROM imported GROUP BY time_ms/$4
            ON CONFLICT(id) DO UPDATE SET token=gen_random_uuid(),cursor_ms=NULL,end_ms=NULL,from_ms=least(history_work.from_ms,excluded.from_ms),until_ms=greatest(history_work.until_ms,excluded.until_ms)`,
        [machine,added,retentionDays,bucketMs]);
    }
    return {configured:topics.length};
}
