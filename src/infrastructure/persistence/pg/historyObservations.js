function bounded(rows) {
    if (rows.length>10000) { throw new Error('History context capacity exceeded; retain work for bounded refinement'); }
    return rows;
}
async function boundary(pool,machine,from,until,padding) {
    const range = await pool.query(`WITH changed AS (
        SELECT DISTINCT channel FROM history_observations WHERE machine=$1 AND time_ms<=greatest($2::bigint,$3::bigint)
    ), latest AS (SELECT max(time_ms) AS at FROM history_observations WHERE machine=$1)
    SELECT greatest($3::bigint+$4::bigint,COALESCE(max(COALESCE(
        (SELECT min(time_ms) FROM history_observations h WHERE h.machine=$1 AND h.channel=c.channel AND h.time_ms>$3),latest.at)), $3)) AS until
    FROM changed c CROSS JOIN latest`, [machine,from,until,padding]);
    return Number(range.rows[0].until);
}
const runs = `WITH timeline AS (
    SELECT DISTINCT time_ms FROM history_observations WHERE machine=$1 AND time_ms BETWEEN $2 AND $3
), breaks AS (SELECT time_ms,lag(time_ms) OVER(ORDER BY time_ms) AS prior FROM timeline),
numbered AS (SELECT time_ms,sum(CASE WHEN prior IS NULL OR time_ms-prior>$4 THEN 1 ELSE 0 END) OVER(ORDER BY time_ms) AS run FROM breaks),
runs AS (SELECT min(time_ms) AS first,max(time_ms) AS last FROM numbered GROUP BY run)`;
async function compact(pool,machine,left,right,padding) {
    const continuity = await pool.query(`${runs} SELECT first,last FROM runs ORDER BY first LIMIT 10001`, [machine,left,right,padding]);
    bounded(continuity.rows);
    const points = await pool.query(`${runs}, points AS (
        SELECT event_id AS "eventId",channel,h.time_ms AS time,value,
            lag(value) OVER(PARTITION BY channel,n.run ORDER BY h.time_ms) AS previous,
            row_number() OVER(PARTITION BY channel,n.run ORDER BY h.time_ms DESC) AS reverse
        FROM history_observations h JOIN numbered n ON n.time_ms=h.time_ms WHERE h.machine=$1 AND h.time_ms BETWEEN $2 AND $3
    ) SELECT "eventId",channel,time,value FROM points
        WHERE previous IS DISTINCT FROM value OR reverse=1 OR time IN (SELECT first FROM runs UNION SELECT last FROM runs)
            OR time IN (SELECT b.prior FROM breaks b JOIN points p ON p.time=b.time_ms WHERE p.previous IS DISTINCT FROM p.value)
        ORDER BY time,channel LIMIT 10001`, [machine,left,right,padding]);
    if (points.rows.length>10000) { throw new Error('History context exceeds bounded semantic changes; split classification work'); }
    return { items: points.rows.map((row) => { return { ...row,time:Number(row.time) }; }),
        continuity:continuity.rows.map((row) => { return {from:Number(row.first),until:Number(row.last)}; }) };
}
async function pageRange(pool,machine,left,end) {
    const times = await pool.query(`SELECT time_ms,count(*) AS size FROM history_observations WHERE machine=$1 AND time_ms BETWEEN $2 AND $3 GROUP BY time_ms ORDER BY time_ms LIMIT 251`,[machine,left,end]);
    let size=0;
    const selected=[];
    for (const row of times.rows) {
        if (selected.length===250 || size+Number(row.size)>10000) { break; }
        selected.push(row);
        size+=Number(row.size);
    }
    if (times.rows.length && !selected.length) { throw new Error('One history timestamp group exceeds bounded context capacity'); }
    const next=times.rows[selected.length] ? Number(times.rows[selected.length].time_ms) : null;
    return {from:left,until:next===null ? end : Number(selected.at(-1).time_ms),next,end};
}

/** PostgreSQL implementation of the bounded raw-observation source. */
export default function historyObservationsPg(pool) {
    return {
        boundary(machine,from,until,padding) { return boundary(pool,machine,from,until,padding); },
        page(machine,left,end) { return pageRange(pool,machine,left,end); },
        read(machine,left,right,padding) { return compact(pool,machine,left,right,padding); }
    };
}
