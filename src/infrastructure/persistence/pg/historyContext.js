import historyRevision from './historyRevision.js';
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
async function islandStart(pool, machine, left, origin, timeScale) {
    if (!Number.isFinite(origin)) { return left; }
    const prior = await pool.query("SELECT start_time FROM segments WHERE machine=$1 AND kind='phase' AND duration>0 AND end_time<=$2 ORDER BY end_time DESC LIMIT 1",
        [machine, new Date(origin/timeScale)]);
    const priorStart = prior.rows[0]?.start_time ? new Date(prior.rows[0].start_time).getTime()*timeScale : origin;
    return Math.min(left, origin, priorStart);
}
async function dependencyEnd(pool, machine, {right, previous, held, classifierKey, claimScope, until, timeScale}) {
    if (claimScope) {
        if (classifierKey && held!==null) { return Math.min(until, held); }
        return Math.min(until, await segmentBoundary(pool,machine,right,previous,timeScale));
    }
    const prior = previous.at(-1);
    const edge = classifierKey && prior && Number(prior.duration)===0 ? right : await segmentBoundary(pool,machine,right,previous,timeScale);
    const extended = classifierKey && held!==null ? held : Math.max(held ?? right,edge);
    const fence = !classifierKey && timeScale===1 ? await historyFence(pool, machine) : null;
    return fence!==null && until<fence ? Math.min(extended, fence-1) : extended;
}
/** Read a finite dependency envelope in stored history, compacting unchanged heartbeat observations. */
// eslint-disable-next-line max-statements
export default async function historyContext(pool,machine,from,until,{padding,cutoff,cursor = null,end: envelope = null,observations: source = historyObservationsPg(pool),classifierKey,timeScale=1,workId,workToken,workPolicy,claimScope = false,classifierOrigin}) {
    if (![from,until,padding].every(Number.isSafeInteger) || from>until || padding<0 || padding>86400000*timeScale) { throw new TypeError('Invalid history range'); }
    const range = { from,until,paddingMs:padding,cursor,end:envelope,...(classifierKey && {classifierKey}),...(timeScale!==1 && {timeScale}),...(workId && {workId,workToken}) };
    if ((cursor !== null && !Number.isSafeInteger(cursor)) || (envelope !== null && !Number.isSafeInteger(envelope))) { throw new TypeError('Invalid history cursor'); }
    const claim=await classifierClaim(pool,machine,{workId,workToken,from,until,cursor,end:envelope});
    if(claim && !claimScope){range.from=Number(claim.from_ms);range.until=Number(claim.until_ms);}
    const held=!claimScope && claim && envelope===null && claim.end_ms!==null ? Number(claim.end_ms) : envelope;
    if (held!==null && envelope===null) { range.end=held; }
    if (from<cutoff && !claim) {
        const pending = cursor === null || envelope === null ? {rowCount:0} : await pool.query(`SELECT 1 FROM history_work WHERE machine=$1 AND from_ms=$2 AND until_ms=$3 AND cursor_ms=$4 AND end_ms=$5 LIMIT 1`,[machine,from,until,cursor,envelope]);
        if (!pending.rowCount) { return {available:false,items:[],segments:[],annotations:[],context:range}; }
    }
    const classifier=classifierKey ? await classifierSeed(pool,machine,cursor ?? from,classifierKey,{claim,cursor}) : null;
    let left = cursor ?? from - padding;
    if (classifierKey && cursor === null) { left = classifier ? classifier.at + 1 : await source.start(machine); }
    const start = workPolicy === 'live' ? Math.max(left, from - padding) : left;
    const boundary = classifierKey && held!==null ? held : Math.max(held ?? until,await source.boundary(machine,from,until,padding));
    const right = claimScope ? Math.min(until, boundary) : boundary;
    const previous = await pool.query(`SELECT kind,name,start_time,end_time,duration FROM segments WHERE machine=$1 AND kind='phase' AND start_time<=$2 ORDER BY start_time DESC LIMIT 1`,[machine,new Date(right/timeScale)]);
    const end = await dependencyEnd(pool, machine, {right,previous:previous.rows,held,classifierKey,claimScope,until,timeScale});
    if(classifierKey && claim && held===null){
        await pool.query('UPDATE history_work SET end_ms=$3 WHERE id=$1 AND machine=$2',[workId,machine,end]);
        range.end=end;
    }
    // Fetch timestamp keys only, then read at most 250 complete groups. Never fetch the raw dependency tail.
    const rawPage = await source.page(machine,start,end);
    const page=classifierKey ? await classifierPage(pool,machine,rawPage,classifierKey) : rawPage;
    const {next,until:pageEnd} = page;
    range.page = page;
    const origin = await islandStart(pool, machine, start, classifierOrigin?.(classifier, timeScale), timeScale);
    const segments = await pool.query(`SELECT kind,name,start_time,end_time,duration,options,tags,properties,resolved,consumed FROM segments
        WHERE machine=$1 AND kind='phase' AND start_time<=$3 AND (end_time>=$2 OR (duration=0 AND start_time>=$2)) ORDER BY start_time LIMIT 10001`,[machine,new Date(origin/timeScale),new Date(pageEnd/timeScale)]);
    bounded(segments.rows);
    const observations = await source.read(machine,start,pageEnd,padding);
    const annotations = await pool.query(`SELECT a.kind,a.name,a.start_time,a.end_time,a.duration,
        CASE WHEN s.machine IS NOT NULL THEN s.tags ELSE a.tags END AS tags,
        CASE WHEN s.machine IS NOT NULL THEN s.properties ELSE a.properties END AS properties,
        CASE WHEN s.machine IS NOT NULL THEN s.resolved ELSE a.resolved END AS resolved,CASE WHEN s.machine IS NOT NULL THEN s.consumed ELSE NULL END AS consumed
        FROM history_annotations a LEFT JOIN segments s ON s.machine=a.machine AND s.kind=a.kind AND s.start_time=a.start_time AND s.name=a.name
        WHERE a.machine=$1 AND a.kind='phase' AND a.start_time<=$3 AND a.end_time>=$2
        AND (COALESCE(a.tags,'') NOT IN ('','null','[]') OR COALESCE(a.properties,'') NOT IN ('','null','{}')) ORDER BY a.start_time,a.name LIMIT 10001`,
    [machine,new Date(start/timeScale),new Date(pageEnd/timeScale)]);
    bounded(annotations.rows);
    const initial = classifierKey ? null : await historySeed(pool,machine,start,padding,{observations:source,timeScale,bounded:claimScope});
    if (initial?.segment && !segments.rows.some((row) => { return row.start_time.getTime() === initial.segment.start_time.getTime(); })) { segments.rows.unshift(initial.segment); }
    const last = observations.items.at(-1)?.time;
    const rightClosed = next === null && last !== undefined && segments.rows.some((row) => { return row.duration>0 && new Date(row.end_time).getTime()*timeScale>=last; });
    const snapshot = { page,initial,...(classifierKey && {classifierSeed:classifier}),annotations:annotations.rows,segments:segments.rows,...observations,rightClosed };
    return { ...snapshot,available:true,revision:historyRevision(snapshot, claimScope ? envelope ?? until : range.until, timeScale),context:range };
}
