import { createHash } from 'node:crypto';
import historySeed from './historySeed.js';

function machineName(machine) {
    if (typeof machine !== 'string' || !machine || machine.length > 200) { throw new TypeError('machine required'); }
}
async function transaction(pool, machine, action) {
    machineName(machine);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
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
                ON CONFLICT(id) DO UPDATE SET token=gen_random_uuid(),from_ms=least(history_work.from_ms,excluded.from_ms),until_ms=greatest(history_work.until_ms,excluded.until_ms)`,
            [machine,Math.floor(time/bucket),time]);
        }
        return { inserted: added.length };
    });
}
function revision(rows) { return createHash('sha256').update(JSON.stringify(rows)).digest('hex'); }
async function context(pool, machine, from, until, { padding, cutoff }) {
    machineName(machine);
    if (![from, until, padding].every(Number.isSafeInteger) || from > until || padding < 0 || padding > 86400000) { throw new TypeError('Invalid history range'); }
    const result = await pool.query(`SELECT event_id AS "eventId", channel, time_ms AS time, value FROM history_observations
        WHERE machine=$1 AND time_ms >= $2 AND time_ms <= $3 ORDER BY time_ms,channel LIMIT 10001`, [machine, from - padding, until + padding]);
    if (result.rows.length > 10000) { throw new Error('History context exceeds bounded page; narrow range'); }
    const segments = await pool.query(`SELECT kind,name,start_time,end_time,duration,options,tags,properties,resolved,consumed FROM segments
        WHERE machine=$1 AND start_time <= $3 AND (end_time >= $2 OR duration=0) ORDER BY start_time`,
    [machine, new Date(from - padding), new Date(until + padding)]);
    const annotations = await pool.query(`SELECT kind,name,start_time,end_time,duration,tags,properties,resolved FROM history_annotations
        WHERE machine=$1 AND start_time <= $3 AND end_time >= $2
            AND (COALESCE(tags,'') NOT IN ('','null','[]') OR COALESCE(properties,'') NOT IN ('','null','{}')) ORDER BY start_time,name`,
    [machine, new Date(from-padding), new Date(until+padding)]);
    const initial = await historySeed(pool,machine,from-padding,padding);
    return { initial, annotations: annotations.rows, available: from >= cutoff, items: result.rows.map((row) => { return { ...row, time: Number(row.time) }; }), segments: segments.rows, revision: revision({ segments: segments.rows, observations: result.rows, initial }), context: { from, until, paddingMs: padding } };
}
async function unchanged(client, machine, base) {
    await client.query('LOCK TABLE segments IN SHARE ROW EXCLUSIVE MODE');
    const latest = await context(client, machine, base.from, base.until, { padding: base.paddingMs, cutoff: -Infinity });
    if (latest.revision !== base.revision) {
        const error = new Error('History context changed');
        error.statusCode = 409;
        throw error;
    }
}
function checkClaim(work, base) {
    if (String(work.token) !== base?.workToken || Number(work.from_ms)<base.from || Number(work.until_ms)>base.until) {
        const error = new Error('History work claim changed');
        error.statusCode=409;
        throw error;
    }
}
function commit(pool, machine, workId, segments, base) {
    if (!Array.isArray(segments) || segments.length > 1000) { throw new TypeError('Bounded segments required'); }
    return transaction(pool, machine, async (client) => {
        const work = await client.query('SELECT id,token,from_ms,until_ms FROM history_work WHERE id=$1 AND machine=$2 FOR UPDATE', [workId, machine]);
        if (!work.rowCount) { return { applied: false }; }
        checkClaim(work.rows[0],base);
        if (segments.length && !base?.revision) { throw new TypeError('History context revision required'); }
        if (base?.revision) { await unchanged(client, machine, base); }
        await client.query(`INSERT INTO history_annotations(machine,kind,start_time,name,end_time,duration,tags,properties,resolved)
            SELECT machine,kind,start_time,name,end_time,duration,tags,properties,resolved FROM segments
            WHERE machine=$1
            ON CONFLICT(machine,kind,start_time,name) DO UPDATE SET end_time=EXCLUDED.end_time,duration=EXCLUDED.duration,tags=EXCLUDED.tags,properties=EXCLUDED.properties,resolved=EXCLUDED.resolved`, [machine]);
        for (const item of segments) {
            // Only computed fields change. User cuts/labels must be applied by caller before commit.
            // eslint-disable-next-line no-await-in-loop
            await client.query(`INSERT INTO segments(machine,kind,name,start_time,end_time,duration,options,tags,properties,resolved)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(machine,kind,start_time) DO UPDATE
                SET name=EXCLUDED.name,end_time=EXCLUDED.end_time,duration=EXCLUDED.duration,options=EXCLUDED.options,
                tags=CASE WHEN segments.name=EXCLUDED.name THEN segments.tags ELSE EXCLUDED.tags END,
                properties=CASE WHEN segments.name=EXCLUDED.name THEN segments.properties ELSE EXCLUDED.properties END,
                resolved=CASE WHEN segments.name=EXCLUDED.name THEN segments.resolved ELSE EXCLUDED.resolved END`,
            [machine, item.kind ?? 'phase', item.name, item.start_time, item.end_time, item.duration,
                typeof item.options === 'string' ? item.options : JSON.stringify(item.options ?? null),
                typeof item.tags === 'string' ? item.tags : JSON.stringify(item.tags ?? null),
                typeof item.properties === 'string' ? item.properties : JSON.stringify(item.properties ?? null), item.resolved ?? true]);
        }
        await client.query('DELETE FROM history_work WHERE id=$1 AND machine=$2', [workId, machine]);
        return { applied: true };
    });
}
/** Local telemetry history and durable classification work; no cross-edge database dependency. */
export default function historyPg(pool, { retentionDays = 30, now = Date.now } = {}) {
    if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0) { throw new TypeError('Positive retentionDays required'); }
    function cutoff() { return now() - retentionDays * 86400000; }
    return {
        configure(machine, topics, bucketMs = 30000) {
            if (!Array.isArray(topics) || topics.length > 500 || !Number.isSafeInteger(bucketMs) || bucketMs <= 0) { throw new TypeError('Invalid history topics'); }
            return transaction(pool, machine, async (client) => {
                await client.query('DELETE FROM history_topics WHERE machine=$1', [machine]);
                for (const item of topics) {
                    if (typeof item.topic !== 'string' || !item.topic || typeof item.channel !== 'string' || !item.channel) { throw new TypeError('Invalid history topic'); }
                    // eslint-disable-next-line no-await-in-loop
                    await client.query('INSERT INTO history_topics(machine,topic,channel,bucket_ms,retention_days) VALUES($1,$2,$3,$4,$5)', [machine,item.topic,item.channel,bucketMs,retentionDays]);
                }
                return { configured: topics.length };
            });
        },
        async purge() {
            const result = await pool.query(`DELETE FROM history_observations o WHERE time_ms < $1
                AND NOT EXISTS (SELECT 1 FROM history_work w WHERE w.machine=o.machine
                    AND o.time_ms BETWEEN w.from_ms-86400000 AND w.until_ms+86400000)
                AND EXISTS (SELECT 1 FROM history_observations newer WHERE newer.machine=o.machine
                    AND newer.channel=o.channel AND newer.time_ms>o.time_ms AND newer.time_ms<$1)`, [cutoff()]);
            return result.rowCount;
        },
        accept(machine, items) { return accept(pool, machine, items, cutoff()); },
        context(machine, from, until, padding = 60000) { return context(pool, machine, from, until, { padding, cutoff: cutoff() }); },
        async work(machine) {
            machineName(machine);
            const result = await pool.query('SELECT id,token,machine AS "streamId",from_ms AS "from",until_ms AS "until" FROM history_work WHERE machine=$1 ORDER BY created_at,id LIMIT 100', [machine]);
            return { items: result.rows.map((row) => { return { ...row, from: Number(row.from), until: Number(row.until) }; }) };
        },
        commit(machine, workId, segments, base) { return commit(pool, machine, workId, segments, base); }
    };
}
