import assert from 'node:assert/strict';
import pg from 'pg';
import {GenericContainer} from 'testcontainers';
import {readFile} from 'node:fs/promises';
import historyPg from '../../src/infrastructure/persistence/pg/history.js';

describe('Native bounded history exterior',function(){
    this.timeout(120000);
    let container;
    let pool;
    before(async () => {
        if (process.env.HISTORY_TEST_POSTGRES_URL) { pool = new pg.Pool({connectionString:process.env.HISTORY_TEST_POSTGRES_URL}); } else {
            container = await new GenericContainer('postgres:16-alpine').withEnvironment({ POSTGRES_PASSWORD: 'test' }).withExposedPorts(5432).start();
            pool = new pg.Pool({ host: container.getHost(), port: container.getMappedPort(5432), user: 'postgres', password: 'test' });
        }
        for (let attempt = 0; attempt < 30; attempt += 1) {
            // eslint-disable-next-line no-await-in-loop
            try { await pool.query('SELECT 1'); break; } catch { await new Promise((resolve) => { setTimeout(resolve, 300); }); }
        }
        await pool.query(await readFile(new URL('../../db/migrations/V0001__baseline.sql', import.meta.url), 'utf8'));
        await pool.query(await readFile(new URL('../../db/migrations/V0008__segments_updated_at.sql', import.meta.url), 'utf8'));
        await pool.query(await readFile(new URL('../../db/migrations/E0001__edge_metrics.sql', import.meta.url), 'utf8'));
        await pool.query(await readFile(new URL('../../db/migrations/E0006__historical_telemetry.sql', import.meta.url), 'utf8'));
        await pool.query(await readFile(new URL('../../db/migrations/E0007__metric_receipts.sql', import.meta.url), 'utf8'));
        await pool.query(await readFile(new URL('../../db/migrations/E0009__history_continuation.sql', import.meta.url), 'utf8'));
        await pool.query(await readFile(new URL('../../db/migrations/E0010__history_admissions.sql', import.meta.url), 'utf8'));
        await pool.query(await readFile(new URL('../../db/migrations/E0011__history_classifier_checkpoints.sql', import.meta.url), 'utf8'));
        await pool.query(await readFile(new URL('../../db/migrations/E0013__history_staged_corrections.sql', import.meta.url), 'utf8'));
        await pool.query(await readFile(new URL('../../db/migrations/E0015__history_retention_frontier.sql', import.meta.url), 'utf8'));
    });
    after(async () => { await pool?.end(); await container?.stop(); });

    async function fixture(label,pageUntil=10000,next=null){
        const time=Date.now()-60000;const machine=`native-${label}`;
        const source=()=>{return {async registered(){},async seed(){return null;},async boundary(){return time+pageUntil;},
            async page(_machine,left,end){return {from:left,until:time+pageUntil,next:next===null?null:time+next,end};},
            async read(_machine,left,right){return {items:[4000,8000,10000].map(offset=>{return {eventId:`e${offset}`,channel:'state',time:time+offset,value:offset===10000?1:0};}).filter(row=>{return row.time>=left&&row.time<=right;}),continuity:[{from:left,until:right}]};}
        };};
        const store=historyPg(pool,{observations:source});const configured=await store.configure(machine,[{topic:`${machine}/state`,channel:'state'}]);
        for(const [start,end,name,tag]of[[0,4000,'a','left'],[4000,10000,'a','right'],[10000,20000,'b','tail']]){
            // eslint-disable-next-line no-await-in-loop
            await pool.query('INSERT INTO segments(machine,kind,name,start_time,end_time,duration,tags,properties,resolved,consumed)VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9)',[machine,'phase',name,new Date(time+start),new Date(time+end),(end-start)/1000,JSON.stringify([tag]),JSON.stringify({operator:tag}),tag==='left']);
        }
        await pool.query('INSERT INTO history_work(id,machine,from_ms,until_ms)VALUES(gen_random_uuid(),$1,$2,$2)',[machine,time+4000]);
        const work=(await store.work(machine)).items[0];const snapshot=await store.context(machine,work.from,work.until,0);
        const row=(start,end,name='b',extra={})=>{return {kind:'phase',name,start_time:new Date(time+start).toISOString(),end_time:new Date(time+end).toISOString(),duration:(end-start)/1000,...extra};};
        const proof={kind:'phase',name:'b',start_time:new Date(time+10000).toISOString(),end_time:new Date(time+20000).toISOString()};
        const base={...snapshot.context,revision:snapshot.revision,workToken:work.token};
        return {time,machine,store,configured,work,snapshot,row,proof,base};
    }
    it('advertises the native suffix contract on configuration',async()=>{
        const current=await fixture('protocol');assert.equal(current.configured.nativeTailProtocol,'preserve-known-suffix-v1');
    });
    it('accepts only a CAS-proved existing terminal tail and preserves user metadata',async()=>{
        const current=await fixture('preserve');
        await current.store.commit(current.machine,current.work.id,[current.row(10000,20000,'b',{preserveSuffix:current.proof})],{...current.base,nativeTailMode:'preserve-known-suffix-v1'});
        const rows=(await pool.query('SELECT end_time,tags,properties,resolved,consumed FROM segments WHERE machine=$1 AND start_time=$2',[current.machine,new Date(current.time+10000)])).rows;
        assert.equal(rows[0].end_time.getTime(),current.time+20000);assert.equal(rows[0].tags,'["tail"]');assert.equal(rows[0].properties,'{"operator":"tail"}');assert.equal(rows[0].resolved,true);assert.equal(rows[0].consumed,false);assert.equal((await current.store.work(current.machine)).items.length,0);
    });
    it('rejects legacy clipping before any projection write or work retirement',async()=>{
        const current=await fixture('clipped');
        await assert.rejects(current.store.commit(current.machine,current.work.id,[current.row(10000,10000)],current.base),/tail|suffix/u);
        assert.equal((await pool.query('SELECT end_time FROM segments WHERE machine=$1 AND start_time=$2',[current.machine,new Date(current.time+10000)])).rows[0].end_time.getTime(),current.time+20000);assert.equal((await current.store.work(current.machine)).items.length,1);
    });
    it('rejects a forged extension and leaves the durable work pending',async()=>{
        const current=await fixture('forged');
        await assert.rejects(current.store.commit(current.machine,current.work.id,[current.row(10000,30000,'b',{preserveSuffix:current.proof})],{...current.base,nativeTailMode:'preserve-known-suffix-v1'}),/bounded|suffix/u);assert.equal((await current.store.work(current.machine)).items.length,1);
    });
    it('allows a real transition within the observed page and inherits consumed on new same-class children',async()=>{
        const current=await fixture('inside');
        await current.store.commit(current.machine,current.work.id,[current.row(4000,5000,'a'),current.row(5001,6000,'b'),current.row(6001,10000,'a',{consumed:false,tags:['right'],properties:{operator:'right'},resolved:true})],{...current.base,nativeTailMode:'preserve-known-suffix-v1'});
        const rows=(await pool.query('SELECT start_time,end_time,consumed FROM segments WHERE machine=$1 ORDER BY start_time',[current.machine])).rows;
        assert.equal(rows.find(row=>{return row.start_time.getTime()===current.time+4000;}).end_time.getTime(),current.time+5000);
        assert.equal(rows.find(row=>{return row.start_time.getTime()===current.time+6001;}).consumed,false);
    });
    it('retains an incomplete page exterior through an explicit existing-owner suffix',async()=>{
        const current=await fixture('partial',8000,9000);const owner={kind:'phase',name:'a',start_time:new Date(current.time+4000).toISOString(),end_time:new Date(current.time+10000).toISOString()};
        await current.store.commit(current.machine,current.work.id,[current.row(4000,7000,'a'),current.row(7001,8000,'b'),current.row(8001,10000,'a',{preserveSuffix:owner,consumed:false,tags:['right'],properties:{operator:'right'}})],{...current.base,nativeTailMode:'preserve-known-suffix-v1'});
        const remaining=(await current.store.work(current.machine)).items;assert.equal(remaining.length,1);assert.equal(remaining[0].cursor,current.time+9000);
        assert.equal((await pool.query('SELECT end_time,consumed FROM segments WHERE machine=$1 AND start_time=$2',[current.machine,new Date(current.time+8001)])).rows[0].end_time.getTime(),current.time+10000);
    });
    it('rejects a stale suffix proof after an operator edits the context',async()=>{
        const current=await fixture('stale');
        await pool.query("UPDATE segments SET tags='[\"new operator label\"]' WHERE machine=$1",[current.machine]);
        await assert.rejects(current.store.commit(current.machine,current.work.id,[current.row(10000,20000,'b',{preserveSuffix:current.proof})],{...current.base,nativeTailMode:'preserve-known-suffix-v1'}),error=>{return error.statusCode===409;});
        assert.equal((await current.store.work(current.machine)).items.length,1);
    });
    it('does not accept an archive-only owner as proof of a current exterior',async()=>{
        const current=await fixture('archived');
        await pool.query('INSERT INTO history_annotations(machine,kind,name,start_time,end_time,duration) VALUES($1,$2,$3,$4,$5,10)',[current.machine,'phase','gone',new Date(current.time+10000),new Date(current.time+20000)]);
        const snapshot=await current.store.context(current.machine,current.work.from,current.work.until,0);
        const proof={...current.proof,name:'gone'};
        await assert.rejects(current.store.commit(current.machine,current.work.id,[current.row(10000,20000,'gone',{preserveSuffix:proof})],{...snapshot.context,revision:snapshot.revision,workToken:current.work.token,nativeTailMode:'preserve-known-suffix-v1'}),/suffix/u);
    });
    it('rejects suffixes whose kind, class or owner end differs from the current row',async()=>{
        const current=await fixture('identity');
        for(const proof of [{...current.proof,kind:'other'},{...current.proof,name:'a'},{...current.proof,end_time:new Date(current.time+21000).toISOString()}]){
            // eslint-disable-next-line no-await-in-loop
            await assert.rejects(current.store.commit(current.machine,current.work.id,[current.row(10000,20000,'b',{preserveSuffix:proof})],{...current.base,nativeTailMode:'preserve-known-suffix-v1'}),/suffix/u);
        }
        assert.equal((await current.store.work(current.machine)).items.length,1);
    });
    it('rolls back every row when a renamed partial tail is not preserved',async()=>{
        const current=await fixture('atomic',8000,9000);
        await assert.rejects(current.store.commit(current.machine,current.work.id,[current.row(0,2000,'a'),current.row(4000,8000,'b')],{...current.base,nativeTailMode:'preserve-known-suffix-v1'}),/tail/u);
        const rows=(await pool.query('SELECT name,end_time FROM segments WHERE machine=$1 ORDER BY start_time',[current.machine])).rows;
        assert.equal(rows[0].end_time.getTime(),current.time+4000);assert.equal(rows[1].name,'a');
        assert.equal((await current.store.work(current.machine)).items[0].cursor,null);
    });
    it('does not overwrite an unseen cut at the proposed exterior key',async()=>{
        const current=await fixture('collision',8000,9000);
        await pool.query('INSERT INTO segments(machine,kind,name,start_time,end_time,duration) VALUES($1,$2,$3,$4,$5,0)',[current.machine,'phase','b',new Date(current.time+8001),new Date(current.time+8500)]);
        const snapshot=await current.store.context(current.machine,current.work.from,current.work.until,0);
        const owner={kind:'phase',name:'a',start_time:new Date(current.time+4000).toISOString(),end_time:new Date(current.time+10000).toISOString()};
        await assert.rejects(current.store.commit(current.machine,current.work.id,[current.row(4000,7000,'a'),current.row(7001,8000,'b'),current.row(8001,10000,'a',{preserveSuffix:owner})],{...snapshot.context,revision:snapshot.revision,workToken:current.work.token,nativeTailMode:'preserve-known-suffix-v1'}),/collides/u);
        assert.equal((await pool.query('SELECT name FROM segments WHERE machine=$1 AND start_time=$2',[current.machine,new Date(current.time+8001)])).rows[0].name,'b');
    });

});
