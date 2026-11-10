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
    const result=await client.query(`SELECT t.machine,t.topic,t.bucket_ms,t.retention_days,COALESCE(r.retained_from,-9007199254740991) AS retained_from
        FROM history_topics t LEFT JOIN history_sources s ON s.machine=t.machine LEFT JOIN history_retention r ON r.source_id=s.source_id
        WHERE t.topic=ANY($1::text[]) ORDER BY t.machine,t.topic`,[[...new Set(records.map(({topic}) => {return topic;}))]]);
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
async function enqueue(client,mapping,row) {
    const pending=await client.query('SELECT id FROM history_work WHERE machine=$1 AND cursor_ms IS NULL AND end_ms IS NULL AND floor(from_ms::numeric/$2)=floor($3::numeric/$2) ORDER BY created_at LIMIT 1',[mapping.machine,mapping.bucket_ms,row.time]);
    if(pending.rowCount){
        await client.query('UPDATE history_work SET token=gen_random_uuid(),generation=gen_random_uuid(),started=false,classifier_checkpoint=NULL,correction_from=NULL,correction_until=NULL,from_ms=least(from_ms,$2),until_ms=greatest(until_ms,$2) WHERE id=$1',[pending.rows[0].id,row.time]);
    }else{await client.query('INSERT INTO history_work(id,machine,from_ms,until_ms) VALUES(gen_random_uuid(),$1,$2,$2)',[mapping.machine,row.time]);}
}
/** Durable queue redelivery owns payload recovery. Barriers never expire on a timer. */
export default function historyAdmission(pool,{now=Date.now,timeScale=1,timestamp}={}) {
    return {
        prepare(records) {
            return transaction(pool,records,async (client,items) => {
                for (const row of items) {
                    // eslint-disable-next-line no-await-in-loop
                    await client.query('INSERT INTO history_admissions(event_id,topic,time_ms,admitted_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[row.id,row.topic,row.time,now()]);
                }
            },{timeScale,timestamp});
        },
        complete(records) {
            return transaction(pool,records,async (client,items,mappings) => {
                const ids=[...new Set(items.map(({id}) => {return id;}))];
                const prepared=await client.query('SELECT event_id,COALESCE(admitted_at,extract(epoch FROM created_at)*$2)::bigint AS admitted_at FROM history_admissions WHERE event_id=ANY($1::text[]) ORDER BY event_id',[ids,1000*timeScale]);
                if (prepared.rowCount!==ids.length) { throw new TypeError('Durable prepare required before admission completion'); }
                const admitted=new Map(prepared.rows.map(row=>{return [row.event_id,Number(row.admitted_at)];}));
                for (const mapping of mappings) {
                    const eligible=items.filter(row=>{return row.topic===mapping.topic && row.time>=Math.max(Number(mapping.retained_from),admitted.get(row.id)-mapping.retention_days*86400000*timeScale);});
                    const times=eligible.map(({time}) => {return time;});
                    if (times.length) {
                        // eslint-disable-next-line no-await-in-loop
                        await client.query('UPDATE history_checkpoints SET valid=false WHERE machine=$1 AND time_ms>=$2',[mapping.machine,Math.min(...times)]);
                        // eslint-disable-next-line no-await-in-loop
                        await client.query('UPDATE history_work SET token=gen_random_uuid(),cursor_ms=NULL,end_ms=NULL,generation=gen_random_uuid(),classifier_checkpoint=NULL,correction_from=NULL,correction_until=NULL,started=false WHERE machine=$1 AND cursor_ms>$2',[mapping.machine,Math.min(...times)]);
                    }
                    for (const row of eligible) {
                        // eslint-disable-next-line no-await-in-loop
                        await enqueue(client,mapping,row);
                    }
                }
                await client.query('DELETE FROM history_admissions WHERE event_id=ANY($1::text[])',[items.map(({id}) => {return id;})]);
            },{timeScale,timestamp});
        }
    };
}
