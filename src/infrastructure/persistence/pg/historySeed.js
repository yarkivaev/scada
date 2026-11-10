/** Complete carried parameters at the left context boundary within the last continuous run. */
export default async function historySeed(pool, machine, before, maxGap, observations) {
    const external = observations?.seed ? await observations.seed(machine,before,maxGap) : undefined;
    if (external === null) { return null; }
    if (external !== undefined) {
        const prior = await pool.query(`SELECT kind,name,start_time,end_time,duration,options,tags,properties,resolved FROM segments
            WHERE machine=$1 AND kind='phase' AND start_time<=$2 AND (end_time >= $3 OR (duration=0 AND start_time >= $3)) ORDER BY start_time DESC LIMIT 1`,
        [machine,new Date(external.time),new Date(external.since)]);
        return {...external,segment:prior.rows[0] ?? null};
    }
    const result = await pool.query(`WITH times AS (
        SELECT DISTINCT time_ms FROM history_observations WHERE machine=$1 AND time_ms<$2
    ), gaps AS (
        SELECT time_ms,time_ms-lag(time_ms) OVER (ORDER BY time_ms) AS gap FROM times
    ), boundary AS (
        SELECT COALESCE(max(time_ms) FILTER (WHERE gap>$3),min(time_ms)) AS at FROM gaps
    ) SELECT DISTINCT ON (channel) channel,time_ms AS time,value,boundary.at AS since FROM history_observations,boundary
        WHERE machine=$1 AND time_ms>=boundary.at AND time_ms<$2 ORDER BY channel,time_ms DESC`, [machine,before,maxGap]);
    if (!result.rows.length) { return null; }
    const time = Math.max(...result.rows.map((row) => { return Number(row.time); }));
    const since = Number(result.rows[0].since);
    const prior = await pool.query(`SELECT kind,name,start_time,end_time,duration,options,tags,properties,resolved FROM segments
        WHERE machine=$1 AND kind='phase' AND start_time<=$2 AND (end_time >= $3 OR (duration=0 AND start_time >= $3)) ORDER BY start_time DESC LIMIT 1`,
    [machine,new Date(time),new Date(since)]);
    return { since, segment: prior.rows[0] ?? null, time: Math.max(...result.rows.map((row) => { return Number(row.time); })),
        values: Object.fromEntries(result.rows.map((row) => { return [row.channel,row.value]; })) };
}
