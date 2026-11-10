export async function assertClassifier(pool,machine,key) {
    if (typeof key!=='string' || !key || key.length>200) { throw new TypeError('Bounded classifier identity required'); }
    const current=await pool.query('SELECT classifier_key FROM history_classifiers WHERE machine=$1',[machine]);
    if (current.rows[0]?.classifier_key!==key) {const error=new Error('History classifier changed');error.statusCode=409;throw error;}
}
export async function classifierClaim(pool,machine,{workId,workToken,from,until,cursor,end}) {
    if(!workId){return null;}
    const result=await pool.query('SELECT classifier_checkpoint,started,from_ms,until_ms,cursor_ms,end_ms FROM history_work WHERE id=$1 AND machine=$2 AND token=$3',[workId,machine,workToken]);
    const row=result.rows[0];
    if(!row || Number(row.from_ms)!==from || Number(row.until_ms)!==until || (row.cursor_ms===null?null:Number(row.cursor_ms))!==cursor || (row.end_ms===null?null:Number(row.end_ms))!==end){const error=new Error('History work claim changed');error.statusCode=409;throw error;}
    return row;
}
export async function classifierSeed(pool,machine,before,key,{claim,cursor}={}) {
    await assertClassifier(pool,machine,key);
    if(claim && cursor!==null){
        const checkpoint=claim.classifier_checkpoint;
        if(!checkpoint || checkpoint.key!==key){throw new Error('Durable classifier continuation checkpoint required');}
        return {at:checkpoint.at,state:checkpoint.state};
    }
    const result=await pool.query('SELECT time_ms,state FROM history_checkpoints WHERE machine=$1 AND classifier_key=$2 AND valid AND time_ms<$3 ORDER BY time_ms DESC LIMIT 1',[machine,key,before]);
    return result.rowCount ? {at:Number(result.rows[0].time_ms),state:result.rows[0].state} : null;
}
export async function classifierPage(pool,machine,page,key) {
    const target=await pool.query('SELECT time_ms FROM history_checkpoints WHERE machine=$1 AND classifier_key=$2 AND time_ms BETWEEN $3 AND $4 ORDER BY time_ms LIMIT 1',[machine,key,page.from,page.until]);
    if (!target.rowCount || Number(target.rows[0].time_ms)===page.until) { return page; }
    const until=Number(target.rows[0].time_ms);
    return {...page,until,next:until+1};
}
/** Checkpoints are committed in the same transaction as segments and the work cursor. */
export async function saveCheckpoint(client,machine,checkpoint,context,work) {
    if (!checkpoint) {return false;}
    const {key,at,state}=checkpoint;
    if (!context || key!==context.context.classifierKey || !Number.isSafeInteger(at) || at!==context.items.at(-1)?.time
        || !state || typeof state!=='object' || Array.isArray(state) || Buffer.byteLength(JSON.stringify(state))>1048576) {
        throw new TypeError('Invalid bounded classifier checkpoint');
    }
    await assertClassifier(client,machine,key);
    const result=await client.query('SELECT 1 FROM history_checkpoints WHERE machine=$1 AND classifier_key=$2 AND time_ms=$3 AND state=$4::jsonb',[machine,key,at,JSON.stringify(state)]);
    if(work){
        await client.query('INSERT INTO history_staged_checkpoints(work_id,generation,machine,classifier_key,time_ms,state) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(work_id,generation,classifier_key,time_ms) DO UPDATE SET state=EXCLUDED.state',[work.id,work.generation,machine,key,at,JSON.stringify(state)]);
        await client.query('UPDATE history_work SET classifier_checkpoint=$2 WHERE id=$1',[work.id,JSON.stringify(checkpoint)]);
    } else {
        await client.query('INSERT INTO history_checkpoints(machine,classifier_key,time_ms,state,valid) VALUES($1,$2,$3,$4,true) ON CONFLICT(machine,classifier_key,time_ms) DO UPDATE SET state=EXCLUDED.state,valid=true',[machine,key,at,JSON.stringify(state)]);
    }
    return result.rowCount>0 && at>=context.context.until;
}
export async function configureClassifier(client,machine,key,source) {
    if (key===undefined) {return;}
    if (typeof key!=='string' || !key || key.length>200) { throw new TypeError('Bounded classifier identity required'); }
    const old=await client.query('SELECT classifier_key FROM history_classifiers WHERE machine=$1',[machine]);
    await client.query('INSERT INTO history_classifiers(machine,classifier_key) VALUES($1,$2) ON CONFLICT(machine) DO UPDATE SET classifier_key=EXCLUDED.classifier_key',[machine,key]);
    if (old.rows[0]?.classifier_key===key) {return;}
    await client.query('DELETE FROM history_checkpoints WHERE machine=$1',[machine]);
    await client.query('UPDATE history_work SET token=gen_random_uuid(),cursor_ms=NULL,end_ms=NULL,generation=gen_random_uuid(),classifier_checkpoint=NULL,correction_from=NULL,correction_until=NULL,started=false WHERE machine=$1',[machine]);
    if (source?.registered) { await source.registered(machine,[],{reset:true}); }
}
