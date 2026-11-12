import { createHash } from 'node:crypto';
import historySeed from './historySeed.js';
import historyObservationsPg from './historyObservations.js';
import {classifierClaim,classifierPage,classifierSeed} from './historyCheckpoint.js';
import historyFence from './historyFence.js';

function bounded(rows) {
    if (rows.length>10000) { throw new Error('History context capacity exceeded; retain work for bounded refinement'); }
    return rows;
}
async function segmentBoundary(pool,machine,right,segments,timeScale) {
    const last = segments.at(-1);
    if (!last) { return right; }
    const following = await pool.query(`SELECT start_time FROM segments WHERE machine=$1 AND kind=$2 AND start_time>$3 AND name<>$4 ORDER BY start_time LIMIT 1`,[machine,last.kind,last.start_time,last.name]);
    const stop = following.rows[0]?.start_time;
    if (stop) { return Math.max(right,new Date(stop).getTime()*timeScale); }
    const tail = await pool.query(`SELECT max(end_time) AS end_time FROM segments WHERE machine=$1 AND kind=$2 AND start_time>=$3`,[machine,last.kind,last.start_time]);
    return Math.max(right,new Date(tail.rows[0].end_time ?? last.end_time).getTime()*timeScale);
}
/** Read a finite dependency envelope in stored history, compacting unchanged heartbeat observations. */
// eslint-disable-next-line max-statements
export default async function historyContext(pool,machine,from,until,{padding,cutoff,cursor = null,end: envelope = null,observations: source = historyObservationsPg(pool),classifierKey,timeScale=1,workId,workToken}) {
    if (![from,until,padding].every(Number.isSafeInteger) || from>until || padding<0 || padding>86400000*timeScale) { throw new TypeError('Invalid history range'); }
    const range = { from,until,paddingMs:padding,cursor,end:envelope,...(classifierKey && {classifierKey}),...(timeScale!==1 && {timeScale}),...(workId && {workId,workToken}) };
    if ((cursor !== null && !Number.isSafeInteger(cursor)) || (envelope !== null && !Number.isSafeInteger(envelope))) { throw new TypeError('Invalid history cursor'); }
    const claim=await classifierClaim(pool,machine,{workId,workToken,from,until,cursor,end:envelope});
    if (from<cutoff && !claim) {
        const pending = cursor === null || envelope === null ? {rowCount:0} : await pool.query(`SELECT 1 FROM history_work WHERE machine=$1 AND from_ms=$2 AND until_ms=$3 AND cursor_ms=$4 AND end_ms=$5 LIMIT 1`,[machine,from,until,cursor,envelope]);
        if (!pending.rowCount) { return {available:false,items:[],segments:[],annotations:[],context:range}; }
    }
    const classifier=classifierKey ? await classifierSeed(pool,machine,cursor ?? from,classifierKey,{claim,cursor}) : null;
    let left = cursor ?? from-padding;
    if (classifierKey && cursor===null) { left=classifier ? classifier.at+1 : await source.start(machine); }
    const right = classifierKey && envelope!==null ? envelope : Math.max(envelope ?? until,await source.boundary(machine,from,until,padding));
    const previous = await pool.query(`SELECT kind,name,start_time,end_time FROM segments WHERE machine=$1 AND kind='phase' AND start_time<=$2 ORDER BY start_time DESC LIMIT 1`,[machine,new Date(right/timeScale)]);
    const tail=classifierKey ? await pool.query("SELECT max(end_time) AS end_time FROM segments WHERE machine=$1 AND kind='phase'",[machine]) : null;
    const extended = classifierKey && envelope!==null ? envelope : Math.max(envelope ?? right,await segmentBoundary(pool,machine,right,previous.rows,timeScale),tail?.rows[0]?.end_time ? new Date(tail.rows[0].end_time).getTime()*timeScale : -Infinity);
    const fence = !classifierKey && timeScale===1 ? await historyFence(pool, machine) : null;
    const end = fence!==null && until<fence ? Math.min(extended, fence-1) : extended;
    if(classifierKey && claim && envelope===null){
        await pool.query('UPDATE history_work SET end_ms=$3 WHERE id=$1 AND machine=$2',[workId,machine,end]);
        range.end=end;
    }
    // Fetch timestamp keys only, then read at most 250 complete groups. Never fetch the raw dependency tail.
    const rawPage = await source.page(machine,left,end);
    const page=classifierKey ? await classifierPage(pool,machine,rawPage,classifierKey) : rawPage;
    const {next,until:pageEnd} = page;
    range.page = page;
    const segments = await pool.query(`SELECT kind,name,start_time,end_time,duration,options,tags,properties,resolved,consumed FROM segments
        WHERE machine=$1 AND kind='phase' AND start_time<=$3 AND (end_time>=$2 OR (duration=0 AND start_time>=$2)) ORDER BY start_time LIMIT 10001`,[machine,new Date(left/timeScale),new Date(pageEnd/timeScale)]);
    bounded(segments.rows);
    const observations = await source.read(machine,left,pageEnd,padding);
    const annotations = await pool.query(`SELECT a.kind,a.name,a.start_time,a.end_time,a.duration,
        CASE WHEN s.machine IS NOT NULL THEN s.tags ELSE a.tags END AS tags,
        CASE WHEN s.machine IS NOT NULL THEN s.properties ELSE a.properties END AS properties,
        CASE WHEN s.machine IS NOT NULL THEN s.resolved ELSE a.resolved END AS resolved,CASE WHEN s.machine IS NOT NULL THEN s.consumed ELSE NULL END AS consumed
        FROM history_annotations a LEFT JOIN segments s ON s.machine=a.machine AND s.kind=a.kind AND s.start_time=a.start_time AND s.name=a.name
        WHERE a.machine=$1 AND a.kind='phase' AND a.start_time<=$3 AND a.end_time>=$2
        AND (COALESCE(a.tags,'') NOT IN ('','null','[]') OR COALESCE(a.properties,'') NOT IN ('','null','{}')) ORDER BY a.start_time,a.name LIMIT 10001`,
    [machine,new Date(left/timeScale),new Date(pageEnd/timeScale)]);
    bounded(annotations.rows);
    const initial = classifierKey ? null : await historySeed(pool,machine,left,padding,{observations:source,timeScale});
    if (initial?.segment && !segments.rows.some((row) => { return row.start_time.getTime() === initial.segment.start_time.getTime(); })) { segments.rows.unshift(initial.segment); }
    const last = observations.items.at(-1)?.time;
    const rightClosed = next === null && last !== undefined && segments.rows.some((row) => { return row.duration>0 && new Date(row.end_time).getTime()*timeScale>=last; });
    const snapshot = { page,initial,...(classifierKey && {classifierSeed:classifier}),annotations:annotations.rows,segments:segments.rows,...observations,rightClosed };
    return { ...snapshot,available:true,revision:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),context:range };
}
