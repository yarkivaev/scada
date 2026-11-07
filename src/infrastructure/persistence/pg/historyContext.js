import { createHash } from 'node:crypto';
import historySeed from './historySeed.js';

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
async function segmentBoundary(pool,machine,right,segments) {
    const last = segments.at(-1);
    if (!last) { return right; }
    const following = await pool.query(`SELECT start_time FROM segments WHERE machine=$1 AND kind=$2 AND start_time>$3 AND name<>$4 ORDER BY start_time LIMIT 1`,[machine,last.kind,last.start_time,last.name]);
    const stop = following.rows[0]?.start_time;
    if (stop) { return Math.max(right,new Date(stop).getTime()); }
    const tail = await pool.query(`SELECT max(end_time) AS end_time FROM segments WHERE machine=$1 AND kind=$2 AND start_time>=$3`,[machine,last.kind,last.start_time]);
    return Math.max(right,new Date(tail.rows[0].end_time ?? last.end_time).getTime());
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
/** Read a finite dependency envelope in stored history, compacting unchanged heartbeat observations. */
// eslint-disable-next-line max-statements
export default async function historyContext(pool,machine,from,until,{padding,cutoff,cursor = null,end: envelope = null}) {
    if (![from,until,padding].every(Number.isSafeInteger) || from>until || padding<0 || padding>86400000) { throw new TypeError('Invalid history range'); }
    const range = { from,until,paddingMs:padding,cursor,end:envelope };
    if ((cursor !== null && !Number.isSafeInteger(cursor)) || (envelope !== null && !Number.isSafeInteger(envelope))) { throw new TypeError('Invalid history cursor'); }
    if (from<cutoff) {
        const pending = cursor === null || envelope === null ? {rowCount:0} : await pool.query(`SELECT 1 FROM history_work WHERE machine=$1 AND from_ms=$2 AND until_ms=$3 AND cursor_ms=$4 AND end_ms=$5 LIMIT 1`,[machine,from,until,cursor,envelope]);
        if (!pending.rowCount) { return {available:false,items:[],segments:[],annotations:[],context:range}; }
    }
    const left = cursor ?? from-padding;
    const right = envelope ?? await boundary(pool,machine,from,until,padding);
    const previous = await pool.query(`SELECT kind,name,start_time,end_time FROM segments WHERE machine=$1 AND kind='phase' AND start_time<=$2 ORDER BY start_time DESC LIMIT 1`,[machine,new Date(right)]);
    const end = envelope ?? await segmentBoundary(pool,machine,right,previous.rows);
    // Fetch timestamp keys only, then read at most 250 complete groups. Never fetch the raw dependency tail.
    const page = await pageRange(pool,machine,left,end);
    const {next,until:pageEnd} = page;
    range.page = page;
    const segments = await pool.query(`SELECT kind,name,start_time,end_time,duration,options,tags,properties,resolved,consumed FROM segments
        WHERE machine=$1 AND kind='phase' AND start_time<=$3 AND (end_time>=$2 OR (duration=0 AND start_time>=$2)) ORDER BY start_time LIMIT 10001`,[machine,new Date(left),new Date(pageEnd)]);
    bounded(segments.rows);
    const observations = await compact(pool,machine,left,pageEnd,padding);
    const annotations = await pool.query(`SELECT a.kind,a.name,a.start_time,a.end_time,a.duration,
        CASE WHEN s.machine IS NOT NULL THEN s.tags ELSE a.tags END AS tags,
        CASE WHEN s.machine IS NOT NULL THEN s.properties ELSE a.properties END AS properties,
        CASE WHEN s.machine IS NOT NULL THEN s.resolved ELSE a.resolved END AS resolved
        FROM history_annotations a LEFT JOIN segments s ON s.machine=a.machine AND s.kind=a.kind AND s.start_time=a.start_time AND s.name=a.name
        WHERE a.machine=$1 AND a.kind='phase' AND a.start_time<=$3 AND a.end_time>=$2
        AND (COALESCE(a.tags,'') NOT IN ('','null','[]') OR COALESCE(a.properties,'') NOT IN ('','null','{}')) ORDER BY a.start_time,a.name LIMIT 10001`,
    [machine,new Date(left),new Date(pageEnd)]);
    bounded(annotations.rows);
    const initial = await historySeed(pool,machine,left,padding);
    if (initial?.segment && !segments.rows.some((row) => { return row.start_time.getTime() === initial.segment.start_time.getTime(); })) { segments.rows.unshift(initial.segment); }
    const last = observations.items.at(-1)?.time;
    const rightClosed = next === null && last !== undefined && segments.rows.some((row) => { return row.duration>0 && new Date(row.end_time).getTime()>=last; });
    const snapshot = { page,initial,annotations:annotations.rows,segments:segments.rows,...observations,rightClosed };
    return { ...snapshot,available:true,revision:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),context:range };
}
