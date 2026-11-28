import { historyWriteFence } from './segmentWriteFence.js';
import nativeHistoryBounds, { clipReplacePage, joinReplacePage, nativeTailProtocol } from './historyNativeBounds.js';
import historyAbsorb, {historyDedupe, span} from './historyAbsorb.js';
import historyFence from './historyFence.js';
import historyPurge from './historyPurge.js';
import historyContext from './historyContext.js';
import historyAdmission, {assertHistoryReady} from './historyAdmission.js';
import {configureClassifier,saveCheckpoint} from './historyCheckpoint.js';
import historyCorrection from './historyCorrection.js';
import historyConfigure from './historyConfigure.js';
import segmentContinue from '../../../domain/segment/segmentContinue.js';
import pgHistorySession from './historySession.js';

export const historyProtocol = 'stateful-correction-v1';

function machineName(machine) {
    if (typeof machine !== 'string' || !machine || machine.length > 200) { throw new TypeError('machine required'); }
}
async function ready(connection, machine, hold = null) {
    try { await assertHistoryReady(connection, machine); return null; }
    catch (error) { if (error.statusCode===409 && hold) { return hold; } throw error; }
}
function transaction(pool, machine, action, { topology = false, statementTimeoutMs } = {}) {
    machineName(machine);
    return pgHistorySession(pool, async (client) => {
        if (topology) { await client.query("SELECT pg_advisory_xact_lock(hashtextextended('history:configuration',0))"); }
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`history:${machine}`]);
        return action(client);
    }, statementTimeoutMs, true);
}
function observations(items) {
    if (!Array.isArray(items) || items.length > 500) { throw new TypeError('At most 500 observations required'); }
    items.forEach((item) => {
        if (typeof item.eventId !== 'string' || !item.eventId || typeof item.channel !== 'string' || !item.channel
            || !Number.isSafeInteger(item.time) || !Number.isFinite(item.value)) { throw new TypeError('Invalid observation'); }
    });
}
function accept(pool, machine, items, cutoff, { claimScope, statementTimeoutMs }) {
    observations(items);
    const reset = claimScope ? '' : 'token=gen_random_uuid(),cursor_ms=NULL,end_ms=NULL,';
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
                ON CONFLICT(id) DO UPDATE SET ${reset}from_ms=least(history_work.from_ms,excluded.from_ms),until_ms=greatest(history_work.until_ms,excluded.until_ms)`,
            [machine,Math.floor(time/bucket),time]);
        }
        return { inserted: added.length };
    }, { statementTimeoutMs });
}
function context(pool,machine,from,until,options) {
    machineName(machine);
    return historyContext(pool,machine,from,until,options);
}
async function snapshot(connection, machine, range, page, observationSource) {
    if (observationSource) {
        const held=await ready(connection,machine,page.workPolicy === 'oldest'&&page.classifierKey&&page.workId&&{available:false,items:[],segments:[],annotations:[],context:{from:range.from,until:range.until,paddingMs:page.padding,...page}});
        if (held) { return held; }
    }
    return context(connection,machine,range.from,range.until,{...page,observations:observationSource?.(connection)});
}
async function unchanged(client, machine, base, {observationSource,timeScale,workPolicy,claimScope,classifierOrigin}) {
    await client.query('LOCK TABLE segments IN SHARE ROW EXCLUSIVE MODE');
    const latest = await context(client, machine, base.from, base.until, { padding: base.paddingMs, cutoff: -Infinity,cursor:base.cursor ?? null,end:base.end ?? null,classifierKey:base.classifierKey,workId:base.workId,workToken:base.workToken,timeScale,workPolicy,claimScope,classifierOrigin,observations:observationSource?.(client) });
    if (latest.revision !== base.revision) {
        const error = Object.assign(new Error('History context changed'), {writeCode:'REVISION_CONFLICT'});
        error.statusCode = 409;
        throw error;
    }
    return latest;
}
function checkClaim(work, base, claimScope) {
    if (String(work.token) !== base?.workToken || Number(work.from_ms)<base.from || (!claimScope && Number(work.until_ms)>base.until) || (work.cursor_ms === null ? null : Number(work.cursor_ms)) !== (base.cursor ?? null) || (work.end_ms === null ? null : Number(work.end_ms)) !== (base.end ?? null)) {
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
async function continueStored(client, machine, item, apply) {
    const prior = await client.query(
        'SELECT name, start_time, end_time FROM segments WHERE machine=$1 AND kind=$2 ORDER BY start_time DESC LIMIT 1',
        [machine, item.kind ?? 'phase']
    );
    return apply({ ...item, start_time: new Date(item.start_time).toISOString(), end_time: new Date(item.end_time).toISOString(),
        duration: item.duration ?? 0 }, prior.rows[0]);
}
function commit(pool, machine, workId, segments, settings) {
    const {base, observationSource,timeScale,processorProperties,workPolicy,claimScope,continueStoredPhase,statementTimeoutMs} = settings;
    if (!Array.isArray(segments) || segments.length > 1000) { throw new TypeError('Bounded segments required'); }
    // eslint-disable-next-line max-statements -- Claim, correction, checkpoint and advancement share one atomic boundary.
    return transaction(pool, machine, client => {return historyWriteFence(client,machine,{base,workId,segments},async () => {
        const work = await client.query(`SELECT id,token,from_ms,until_ms,cursor_ms,end_ms${base?.replace?',generation':''} FROM history_work WHERE id=$1 AND machine=$2 FOR UPDATE`, [workId, machine]);
        if (!work.rowCount) { return { applied: false }; }
        checkClaim(work.rows[0],base,claimScope);
        if (segments.length && !base?.revision) { throw new TypeError('History context revision required'); }
        if (observationSource) { const held=await ready(client,machine,workPolicy === 'live' ? null : {applied:false}); if (held) { return held; } }
        const latest = base?.revision ? await unchanged(client, machine, base, settings) : null;
        const rows = base?.replace && workPolicy === 'live'
            ? joinReplacePage(clipReplacePage(segments, latest, timeScale)) : segments;
        const exteriors = nativeHistoryBounds(rows, latest, base, timeScale);
        for (const item of exteriors) {
            // An unseen existing cut must never be overwritten by a new exterior piece.
            // eslint-disable-next-line no-await-in-loop
            const conflict = await client.query('SELECT 1 FROM segments WHERE machine=$1 AND kind=$2 AND start_time=$3', [machine, item.kind ?? 'phase', item.start_time]);
            if (conflict.rowCount) { throw new TypeError('History suffix collides with a cut outside the observed page'); }
        }
        if(base?.replace){
            const next=await historyCorrection(client,machine,work.rows[0],rows,{base,context:latest,timeScale,processorProperties});
            if (rows.length) { await historyDedupe(client, machine, span(rows)); }
            await advance(client,machine,workId,next);
            return {applied:true};
        }
        await client.query(`INSERT INTO history_annotations(machine,kind,start_time,name,end_time,duration,tags,properties,resolved)
            SELECT machine,kind,start_time,name,end_time,duration,tags,properties,resolved FROM segments
            WHERE machine=$1 AND start_time<=$3 AND end_time>=$2
            ON CONFLICT(machine,kind,start_time,name) DO UPDATE SET end_time=greatest(history_annotations.end_time,EXCLUDED.end_time),duration=EXCLUDED.duration,tags=EXCLUDED.tags,properties=EXCLUDED.properties,resolved=EXCLUDED.resolved`, [machine,new Date((latest?.context.page.from ?? base.from)/timeScale),new Date((latest?.context.page.until ?? base.until)/timeScale)]);
        // A CAS-validated native page supplies its own phase boundaries and exterior.
        const nativePage = workPolicy !== 'live' && base?.nativeTailMode === nativeTailProtocol;
        const folded = nativePage ? segments : await historyAbsorb(client, machine, segments);
        for (const item of folded) {
            // eslint-disable-next-line no-await-in-loop
            const row = continueStoredPhase ? await continueStored(client, machine, item, continueStoredPhase) : item;
            // Only computed fields change. User cuts/labels must be applied by caller before commit.
            // eslint-disable-next-line no-await-in-loop
            await client.query(`INSERT INTO segments(machine,kind,name,start_time,end_time,duration,options,tags,properties,resolved,consumed)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(machine,kind,start_time) DO UPDATE
                SET name=EXCLUDED.name,end_time=EXCLUDED.end_time,duration=EXCLUDED.duration,options=EXCLUDED.options,updated_at=clock_timestamp(),
                tags=CASE WHEN segments.name=EXCLUDED.name THEN segments.tags ELSE EXCLUDED.tags END,
                properties=CASE WHEN segments.name=EXCLUDED.name THEN segments.properties ELSE EXCLUDED.properties END,
                resolved=CASE WHEN segments.name=EXCLUDED.name THEN segments.resolved ELSE EXCLUDED.resolved END`,
            [machine, row.kind ?? 'phase', row.name, row.start_time, row.end_time, row.duration,
                typeof item.options === 'string' ? item.options : JSON.stringify(item.options ?? null),
                typeof item.tags === 'string' ? item.tags : JSON.stringify(item.tags ?? null),
                typeof item.properties === 'string' ? item.properties : JSON.stringify(item.properties ?? null), item.resolved ?? true, item.consumed ?? true]);
        }
        if (!nativePage && segments.length) { await historyDedupe(client, machine, span(segments)); }
        const converged=await saveCheckpoint(client,machine,base?.checkpoint,latest);
        await advance(client,machine,workId,converged ? {next:null} : latest?.context.page);
        return { applied: true };
    })}, { statementTimeoutMs });
}
function ownedProcessorProperties(properties) {
    if (!Array.isArray(properties) || !properties.every((key) => { return typeof key === 'string' && key.length > 0; })) {
        throw new TypeError('Processor properties must be a list of nonempty strings');
    }
    return [...properties];
}
async function eligibleWork(pool, machine, { observationSource, timeScale, workPolicy }) {
    const order = workPolicy === 'live' ? 'until_ms DESC,created_at DESC,id DESC LIMIT 1' : 'until_ms ASC,created_at,id LIMIT 8';
    machineName(machine);
    if (observationSource && await ready(pool,machine,workPolicy === 'live' ? null : {items:[]})) { return {items:[]}; }
    const fence = await historyFence(pool, machine, timeScale);
    const result = await pool.query(`SELECT id,token,machine AS "streamId",from_ms AS "from",until_ms AS "until",cursor_ms AS cursor,end_ms AS end
        FROM history_work WHERE machine=$1 AND until_ms < $2 - COALESCE((SELECT bucket_ms FROM history_topics WHERE machine=$1 LIMIT 1), 30000 * $3)
        ORDER BY ${order}`, [machine, fence, timeScale]);
    return { items: result.rows.map((row) => { return { ...row, from: Number(row.from), until: Number(row.until),cursor:row.cursor === null ? null : Number(row.cursor),end:row.end === null ? null : Number(row.end) }; }) };
}
/** Local telemetry history and durable classification work; no cross-edge database dependency. */
export default function historyPg(pool, { retentionDays = 30, now = Date.now, observations: observationSource,timeScale=1,timestamp,processorProperties = [], workPolicy = 'oldest',
    claimScope = false, classifierOrigin, statementTimeoutMs, purgeBatchSize, continuationSeconds } = {}) {
    if (![1,1000].includes(timeScale) || (timeScale!==1 && !observationSource)) {throw new TypeError('External history supports millisecond or microsecond coordinates');}
    if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0) { throw new TypeError('Positive retentionDays required'); }
    const ownedProperties = ownedProcessorProperties(processorProperties);
    if (!['oldest', 'live'].includes(workPolicy)) { throw new TypeError('Invalid history work policy'); }
    const settings = {
        observationSource, timeScale, workPolicy, claimScope, classifierOrigin, statementTimeoutMs,
        processorProperties: ownedProperties, continueStoredPhase: continuationSeconds ? segmentContinue(continuationSeconds) : null
    };
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
                return {...result,...((timeScale!==1 || classifierKey) && {timeScale}),...(!classifierKey && {nativeTailProtocol}),...(classifierKey && {classifierProtocol:historyProtocol})};
            },{ topology: true, statementTimeoutMs });
        },
        purge() { return historyPurge(pool, cutoff(), retentionDays, purgeBatchSize); },
        accept(machine, items) {
            if (observationSource) { throw new TypeError('External observations require durable telemetry admission'); }
            return accept(pool, machine, items, cutoff(), settings); },
        context(machine, from, until, padding = 60000*timeScale, page = {}) {
            const options={padding,cutoff:cutoff(),...page,timeScale,workPolicy,claimScope,classifierOrigin};
            function read(connection) { return snapshot(connection,machine,{from,until},options,observationSource); }
            return page.classifierKey && page.workId ? transaction(pool,machine,read,{ statementTimeoutMs })
                : pgHistorySession(pool, read, statementTimeoutMs);
        },
        work(machine) { return pgHistorySession(pool, (connection) => { return eligibleWork(connection, machine, settings); }, statementTimeoutMs); },
        commit(machine, workId, segments, base) { return commit(pool, machine, workId, segments, {...settings, base}); }
    };
}
