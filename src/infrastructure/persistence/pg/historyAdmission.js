import {createHash} from 'node:crypto';

function normalized(records,{timestamp,timeScale}) {
    if (!Array.isArray(records) || !records.length || records.length>10000) { throw new TypeError('Bounded telemetry admissions required'); }
    return records.map(({topic,ts,value}) => {
        const time=timestamp ? timestamp(ts) : (ts instanceof Date ? ts.getTime() : ts)*timeScale;
        if (typeof topic!=='string' || !topic || !Number.isSafeInteger(time) || !Number.isFinite(value)) { throw new TypeError('Original integer timestamp and finite admission value required'); }
        const binary=Buffer.alloc(8); binary.writeDoubleLE(value);
        return {topic,time,id:createHash('sha256').update(`${Buffer.byteLength(topic)}:${topic}:${time}:`).update(binary).digest('hex')};
    }).sort((a,b) => { return a.id.localeCompare(b.id); });
}
async function mapped(client,records) {
    const result=await client.query('SELECT machine,topic,bucket_ms,retention_days FROM history_topics WHERE topic=ANY($1::text[]) ORDER BY machine,topic',[[...new Set(records.map(({topic}) => {return topic;}))]]);
    return result.rows;
}
async function locks(client,mappings) {
    for (const machine of [...new Set(mappings.map((row) => {return row.machine;}))].sort()) {
        // eslint-disable-next-line no-await-in-loop
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`history:${machine}`]);
    }
}
async function transaction(pool,records,action,options) {
    const items=normalized(records,options);
    const client=await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('history:configuration',0))");
        const mappings=await mapped(client,items);
        await locks(client,mappings);
        await action(client,items,mappings);
        await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function assertHistoryReady(pool,machine) {
    const result=await pool.query('SELECT 1 FROM history_admissions a JOIN history_topics t ON t.topic=a.topic WHERE t.machine=$1 LIMIT 1',[machine]);
    if (result.rowCount) { const error=new Error('Unfinished external telemetry admission'); error.statusCode=409; throw error; }
}
/** Durable queue redelivery owns payload recovery. Barriers never expire on a timer. */
export default function historyAdmission(pool,{now=Date.now,timeScale=1,timestamp}={}) {
    return {
        prepare(records) {
            return transaction(pool,records,async (client,items) => {
                for (const row of items) {
                    // eslint-disable-next-line no-await-in-loop
                    await client.query('INSERT INTO history_admissions(event_id,topic,time_ms) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[row.id,row.topic,row.time]);
                }
            },{timeScale,timestamp});
        },
        complete(records) {
            return transaction(pool,records,async (client,items,mappings) => {
                const ids=[...new Set(items.map(({id}) => {return id;}))];
                const prepared=await client.query('SELECT event_id FROM history_admissions WHERE event_id=ANY($1::text[]) ORDER BY event_id FOR UPDATE',[ids]);
                if (prepared.rowCount!==ids.length) { throw new TypeError('Durable prepare required before admission completion'); }
                for (const mapping of mappings) {
                    const times=items.filter(({topic}) => {return topic===mapping.topic;}).map(({time}) => {return time;});
                    if (times.length) {
                        // eslint-disable-next-line no-await-in-loop
                        await client.query('UPDATE history_checkpoints SET valid=false WHERE machine=$1 AND time_ms>=$2',[mapping.machine,Math.min(...times)]);
                        // eslint-disable-next-line no-await-in-loop
                        await client.query('UPDATE history_work SET token=gen_random_uuid(),cursor_ms=NULL,end_ms=NULL,generation=gen_random_uuid(),classifier_checkpoint=NULL,correction_from=NULL,correction_until=NULL WHERE machine=$1 AND cursor_ms>$2',[mapping.machine,Math.min(...times)]);
                    }
                    for (const row of items.filter(({topic,time}) => {return topic===mapping.topic && time>=now()-mapping.retention_days*86400000*timeScale;})) {
                        // eslint-disable-next-line no-await-in-loop
                        await client.query(`INSERT INTO history_work(id,machine,from_ms,until_ms)
                            VALUES(md5($1||':'||$2::text)::uuid,$1,$3,$3)
                            ON CONFLICT(id) DO UPDATE SET token=gen_random_uuid(),cursor_ms=NULL,end_ms=NULL,generation=gen_random_uuid(),classifier_checkpoint=NULL,correction_from=NULL,correction_until=NULL,from_ms=least(history_work.from_ms,excluded.from_ms),until_ms=greatest(history_work.until_ms,excluded.until_ms)`,
                        [mapping.machine,Math.floor(row.time/Number(mapping.bucket_ms)),row.time]);
                    }
                }
                await client.query('DELETE FROM history_admissions WHERE event_id=ANY($1::text[])',[items.map(({id}) => {return id;})]);
            },{timeScale,timestamp});
        }
    };
}
