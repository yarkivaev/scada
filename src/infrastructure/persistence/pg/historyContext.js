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
    const following = await pool.query(`SELECT name,start_time,end_time FROM segments
        WHERE machine=$1 AND kind=$2 AND start_time>$3 ORDER BY start_time LIMIT 10001`, [machine,last.kind,last.start_time]);
    let end = Math.max(right,new Date(last.end_time).getTime());
    for (const row of following.rows) {
        if (row.name!==last.name) { return Math.max(end,new Date(row.start_time).getTime()); }
        end=Math.max(end,new Date(row.end_time).getTime());
    }
    if (following.rows.length>10000) { throw new Error('History segment context capacity exceeded'); }
    return end;
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
/** Read a finite dependency envelope in stored history, compacting unchanged heartbeat observations. */
// eslint-disable-next-line max-statements
export default async function historyContext(pool,machine,from,until,{padding,cutoff}) {
    if (![from,until,padding].every(Number.isSafeInteger) || from>until || padding<0 || padding>86400000) { throw new TypeError('Invalid history range'); }
    const range = { from,until,paddingMs:padding };
    if (from<cutoff) { return {available:false,items:[],segments:[],annotations:[],context:range}; }
    const right = await boundary(pool,machine,from,until,padding);
    const segments = await pool.query(`SELECT kind,name,start_time,end_time,duration,options,tags,properties,resolved,consumed FROM segments
        WHERE machine=$1 AND kind='phase' AND start_time<=$3 AND (end_time>=$2 OR duration=0) ORDER BY start_time LIMIT 10001`, [machine,new Date(from-padding),new Date(right)]);
    bounded(segments.rows);
    const end = await segmentBoundary(pool,machine,right,segments.rows);
    if (end>right) {
        const expanded = await pool.query(`SELECT kind,name,start_time,end_time,duration,options,tags,properties,resolved,consumed FROM segments
            WHERE machine=$1 AND kind='phase' AND start_time<=$3 AND (end_time>=$2 OR duration=0) ORDER BY start_time LIMIT 10001`, [machine,new Date(from-padding),new Date(end)]);
        bounded(expanded.rows);
        segments.rows=expanded.rows;
    }
    const observations = await compact(pool,machine,from-padding,end,padding);
    const annotations = await pool.query(`SELECT kind,name,start_time,end_time,duration,tags,properties,resolved FROM history_annotations
        WHERE machine=$1 AND kind='phase' AND start_time<=$3 AND end_time>=$2
        AND (COALESCE(tags,'') NOT IN ('','null','[]') OR COALESCE(properties,'') NOT IN ('','null','{}')) ORDER BY start_time,name LIMIT 10001`,
    [machine,new Date(from-padding),new Date(end)]);
    bounded(annotations.rows);
    const initial = await historySeed(pool,machine,from-padding,padding);
    const last = observations.items.at(-1)?.time;
    const rightClosed = last !== undefined && segments.rows.some((row) => { return row.duration>0 && new Date(row.end_time).getTime()>=last; });
    const snapshot = { initial,annotations:annotations.rows,segments:segments.rows,...observations,rightClosed };
    return { ...snapshot,available:true,revision:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),context:range };
}
