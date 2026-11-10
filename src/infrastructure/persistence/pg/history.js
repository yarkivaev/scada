import retainMetricReceipts from '../../ingest/db/retainMetricReceipts.js';
import historyContext from './historyContext.js';
import historyAdmission, {assertHistoryReady} from './historyAdmission.js';
import {configureClassifier,saveCheckpoint} from './historyCheckpoint.js';
import historyCorrection from './historyCorrection.js';
import historyConfigure from './historyConfigure.js';

export const historyProtocol = 'stateful-correction-v1';

function machineName(machine) {
    if (typeof machine !== 'string' || !machine || machine.length > 200) { throw new TypeError('machine required'); }
}
async function transaction(pool, machine, action, topology=false) {
    machineName(machine);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (topology) {await client.query("SELECT pg_advisory_xact_lock(hashtextextended('history:configuration',0))");}
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`history:${machine}`]);
        const result = await action(client);
        await client.query('COMMIT');
        return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
function observations(items) {
    if (!Array.isArray(items) || items.length > 500) { throw new TypeError('At most 500 observations required'); }
    items.forEach((item) => {
        if (typeof item.eventId !== 'string' || !item.eventId || typeof item.channel !== 'string' || !item.channel
            || !Number.isSafeInteger(item.time) || !Number.isFinite(item.value)) { throw new TypeError('Invalid observation'); }
    });
}
function accept(pool, machine, items, cutoff) {
    observations(items);
    return transaction(pool, machine, async (client) => {
        const added = [];
        for (const item of items) {
            // First committed observation wins; duplicates cannot mutate history or create work.
            // eslint-disable-next-line no-await-in-loop
            const result = await client.query(`INSERT INTO history_observations(machine,channel,time_ms,event_id,value)
                VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING time_ms`, [machine, item.channel, item.time, item.eventId, item.value]);
            if (result.rowCount && item.time >= cutoff) { added.push(item.time); }
        }
        const configured = await client.query('SELECT bucket_ms FROM history_topics WHERE machine=$1 LIMIT 1', [machine]);
        const bucket = Number(configured.rows[0]?.bucket_ms ?? 30000);
        for (const time of added) {
            // eslint-disable-next-line no-await-in-loop
            await client.query(`INSERT INTO history_work(id,machine,from_ms,until_ms)
                VALUES(md5($1||':'||$2::text)::uuid,$1,$3,$3)
                ON CONFLICT(id) DO UPDATE SET token=gen_random_uuid(),cursor_ms=NULL,end_ms=NULL,from_ms=least(history_work.from_ms,excluded.from_ms),until_ms=greatest(history_work.until_ms,excluded.until_ms)`,
            [machine,Math.floor(time/bucket),time]);
        }
        return { inserted: added.length };
    });
}
function context(pool,machine,from,until,options) {
    machineName(machine);
    return historyContext(pool,machine,from,until,options);
}
async function unchanged(client, machine, base, {observationSource,timeScale}) {
    await client.query('LOCK TABLE segments IN SHARE ROW EXCLUSIVE MODE');
    const latest = await context(client, machine, base.from, base.until, { padding: base.paddingMs, cutoff: -Infinity,cursor:base.cursor ?? null,end:base.end ?? null,classifierKey:base.classifierKey,workId:base.workId,workToken:base.workToken,timeScale,observations:observationSource?.(client) });
    if (latest.revision !== base.revision) {
        const error = new Error('History context changed');
        error.statusCode = 409;
        throw error;
    }
    return latest;
}
function checkClaim(work, base) {
    if (String(work.token) !== base?.workToken || Number(work.from_ms)<base.from || Number(work.until_ms)>base.until || (work.cursor_ms === null ? null : Number(work.cursor_ms)) !== (base.cursor ?? null) || (work.end_ms === null ? null : Number(work.end_ms)) !== (base.end ?? null)) {
        const error = new Error('History work claim changed');
        error.statusCode=409;
        throw error;
    }
}
async function advance(client,machine,workId,page) {
    if (page?.next !== null && page?.next !== undefined) {
        await client.query('UPDATE history_work SET cursor_ms=$3,end_ms=$4,token=gen_random_uuid() WHERE id=$1 AND machine=$2',[workId,machine,page.next,page.end]);
    } else { await client.query('DELETE FROM history_work WHERE id=$1 AND machine=$2', [workId, machine]); }
}
function commit(pool, machine, workId, segments, {base, observationSource,timeScale}) {
    if (!Array.isArray(segments) || segments.length > 1000) { throw new TypeError('Bounded segments required'); }
    // eslint-disable-next-line max-statements -- Claim, correction, checkpoint and advancement share one atomic boundary.
    return transaction(pool, machine, async (client) => {
        const work = await client.query(`SELECT id,token,from_ms,until_ms,cursor_ms,end_ms${base?.replace?',generation':''} FROM history_work WHERE id=$1 AND machine=$2 FOR UPDATE`, [workId, machine]);
        if (!work.rowCount) { return { applied: false }; }
        checkClaim(work.rows[0],base);
        if (segments.length && !base?.revision) { throw new TypeError('History context revision required'); }
        if (observationSource) { await assertHistoryReady(client,machine); }
        const latest = base?.revision ? await unchanged(client, machine, base, {observationSource,timeScale}) : null;
        if (latest && segments.some((item) => { return new Date(item.end_time).getTime()>Math.round(latest.context.page.until/timeScale); })) {
            throw new TypeError('Segment extends beyond bounded history page; upgrade history worker');
        }
        if(base?.replace){
            const next=await historyCorrection(client,machine,work.rows[0],segments,{base,context:latest,timeScale});
            await advance(client,machine,workId,next);
            return {applied:true};
        }
        await client.query(`INSERT INTO history_annotations(machine,kind,start_time,name,end_time,duration,tags,properties,resolved)
            SELECT machine,kind,start_time,name,end_time,duration,tags,properties,resolved FROM segments
            WHERE machine=$1 AND start_time<=$3 AND end_time>=$2
            ON CONFLICT(machine,kind,start_time,name) DO UPDATE SET end_time=greatest(history_annotations.end_time,EXCLUDED.end_time),duration=EXCLUDED.duration,tags=EXCLUDED.tags,properties=EXCLUDED.properties,resolved=EXCLUDED.resolved`, [machine,new Date((latest?.context.page.from ?? base.from)/timeScale),new Date((latest?.context.page.until ?? base.until)/timeScale)]);
        for (const item of segments) {
            // Only computed fields change. User cuts/labels must be applied by caller before commit.
            // eslint-disable-next-line no-await-in-loop
            await client.query(`INSERT INTO segments(machine,kind,name,start_time,end_time,duration,options,tags,properties,resolved)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(machine,kind,start_time) DO UPDATE
                SET name=EXCLUDED.name,end_time=EXCLUDED.end_time,duration=EXCLUDED.duration,options=EXCLUDED.options,updated_at=clock_timestamp(),
                tags=CASE WHEN segments.name=EXCLUDED.name THEN segments.tags ELSE EXCLUDED.tags END,
                properties=CASE WHEN segments.name=EXCLUDED.name THEN segments.properties ELSE EXCLUDED.properties END,
                resolved=CASE WHEN segments.name=EXCLUDED.name THEN segments.resolved ELSE EXCLUDED.resolved END`,
            [machine, item.kind ?? 'phase', item.name, item.start_time, item.end_time, item.duration,
                typeof item.options === 'string' ? item.options : JSON.stringify(item.options ?? null),
                typeof item.tags === 'string' ? item.tags : JSON.stringify(item.tags ?? null),
                typeof item.properties === 'string' ? item.properties : JSON.stringify(item.properties ?? null), item.resolved ?? true]);
        }
        const converged=await saveCheckpoint(client,machine,base?.checkpoint,latest);
        await advance(client,machine,workId,converged ? {next:null} : latest?.context.page);
        return { applied: true };
    });
}
/** Local telemetry history and durable classification work; no cross-edge database dependency. */
export default function historyPg(pool, { retentionDays = 30, now = Date.now, observations: observationSource,timeScale=1,timestamp } = {}) {
    if (![1,1000].includes(timeScale) || (timeScale!==1 && !observationSource)) {throw new TypeError('External history supports millisecond or microsecond coordinates');}
    if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0) { throw new TypeError('Positive retentionDays required'); }
    function cutoff() { return (now() - retentionDays * 86400000)*timeScale; }
    const admission=observationSource ? historyAdmission(pool,{now:()=>{return now()*timeScale;},timeScale,timestamp}) : null;
    return {
        ...(admission ?? {}),
        configure(machine, topics, bucketMs = 30000, classifierKey = undefined) {
            if (classifierKey && !observationSource) {throw new TypeError('Stateful classification requires an external observation source');}
            if (!Array.isArray(topics) || topics.length > 500 || !Number.isSafeInteger(bucketMs) || bucketMs <= 0) { throw new TypeError('Invalid history topics'); }
            return transaction(pool,machine,async (client) => {
                const source=observationSource?.(client);
                const result=await historyConfigure(client,machine,topics,bucketMs*timeScale,{retentionDays,observations:source});
                await configureClassifier(client,machine,classifierKey,source);
                return {...result,...((timeScale!==1 || classifierKey) && {timeScale}),...(classifierKey && {classifierProtocol:historyProtocol})};
            },true);
        },
        async purge() {
            const result = await pool.query(`DELETE FROM history_observations o WHERE time_ms < $1
                AND NOT EXISTS (SELECT 1 FROM history_work w WHERE w.machine=o.machine
                    AND (o.time_ms BETWEEN w.from_ms-86400000 AND greatest(w.until_ms,COALESCE(w.end_ms,w.until_ms))+86400000
                    OR (o.time_ms<w.from_ms-86400000 AND NOT EXISTS (SELECT 1 FROM history_observations anchor
                        WHERE anchor.machine=o.machine AND anchor.channel=o.channel AND anchor.time_ms>o.time_ms AND anchor.time_ms<w.from_ms-86400000))))
                AND EXISTS (SELECT 1 FROM history_observations newer WHERE newer.machine=o.machine
                    AND newer.channel=o.channel AND newer.time_ms>o.time_ms AND newer.time_ms<$1)`, [cutoff()]);
            await retainMetricReceipts(pool, retentionDays);
            return result.rowCount;
        },
        accept(machine, items) {
            if (observationSource) { throw new TypeError('External observations require durable telemetry admission'); }
            return accept(pool, machine, items, cutoff()); },
        async context(machine, from, until, padding = 60000*timeScale, page = {}) {
            if (observationSource) { await assertHistoryReady(pool,machine); }
            return context(pool, machine, from, until, { padding, cutoff: cutoff(),...page,timeScale,observations:observationSource?.(pool) });
        },
        async work(machine) {
            machineName(machine);
            if (observationSource) { try { await assertHistoryReady(pool,machine); } catch (error) { if (error.statusCode===409) { return {items:[]}; } throw error; } }
            const result = await pool.query('SELECT id,token,machine AS "streamId",from_ms AS "from",until_ms AS "until",cursor_ms AS cursor,end_ms AS end FROM history_work WHERE machine=$1 ORDER BY until_ms DESC,created_at,id LIMIT 8', [machine]);
            return { items: result.rows.map((row) => { return { ...row, from: Number(row.from), until: Number(row.until),cursor:row.cursor === null ? null : Number(row.cursor),end:row.end === null ? null : Number(row.end) }; }) };
        },
        commit(machine, workId, segments, base) { return commit(pool, machine, workId, segments, {base, observationSource,timeScale}); }
    };
}
