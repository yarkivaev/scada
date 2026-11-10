import {saveCheckpoint} from './historyCheckpoint.js';

function encoded(value){return typeof value==='string'?value:JSON.stringify(value ?? null);}
async function canConverge(client,machine,work,until) {
    const result=await client.query(`SELECT NOT EXISTS(SELECT 1 FROM segments s WHERE s.machine=$1 AND s.kind='phase'
        AND s.start_time<=$4 AND s.end_time>$4 AND NOT EXISTS(
            SELECT 1 FROM history_corrections c WHERE c.work_id=$2 AND c.generation=$3 AND c.name=s.name
                AND c.start_time<=$4 AND c.end_time>=$4 AND c.duration=0)) AS safe`,[machine,work.id,work.generation,until]);
    return result.rows[0].safe;
}
async function writeCorrections(client,machine,work,segments) {
    for(const item of segments){
        if((item.kind ?? 'phase')!=='phase' || !Number.isFinite(item.duration) || item.duration<0 || new Date(item.start_time)>new Date(item.end_time)){throw new TypeError('Valid phase correction required');}
        // eslint-disable-next-line no-await-in-loop
        await client.query(`INSERT INTO history_corrections(work_id,generation,machine,kind,name,start_time,end_time,duration,options,tags,properties,resolved)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(work_id,generation,kind,start_time) DO UPDATE
            SET name=EXCLUDED.name,end_time=EXCLUDED.end_time,duration=EXCLUDED.duration,options=EXCLUDED.options,tags=EXCLUDED.tags,properties=EXCLUDED.properties,resolved=EXCLUDED.resolved`,
        [work.id,work.generation,machine,'phase',item.name,item.start_time,item.end_time,item.duration,encoded(item.options),encoded(item.tags),encoded(item.properties),item.resolved ?? true]);
    }
}
/** Staged results stay invisible until their finite dependency has completed or converged. */
export default async function historyCorrection(client,machine,work,segments,{base,context,timeScale}) {
    if(!context?.context.classifierKey || !base.workId || base.workId!==work.id){throw new TypeError('Claimed classifier context required for staged correction');}
    if(context.items.length && !base.checkpoint){throw new TypeError('Classifier checkpoint required for a nonempty correction page');}
    await writeCorrections(client,machine,work,segments);
    const from=(context.classifierSeed?Math.ceil(context.page.from/timeScale):Math.round(context.page.from/timeScale))*timeScale;
    await client.query(`UPDATE history_work SET correction_from=least(correction_from,$3),correction_until=greatest(correction_until,$4),started=true WHERE id=$1 AND machine=$2`,
        [work.id,machine,from,Math.round(context.page.until/timeScale)*timeScale]);
    const matches=await saveCheckpoint(client,machine,base.checkpoint,context,work);
    const converged=matches && await canConverge(client,machine,work,new Date(Math.round(context.page.until/timeScale)));
    const finished=context.page.next===null || converged;
    if(finished){await client.query('SELECT history_apply_correction($1,$2,$3,$4)',[work.id,machine,timeScale,converged]);}
    return finished?{next:null}:context.page;
}
