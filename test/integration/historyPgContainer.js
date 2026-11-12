import assert from 'node:assert/strict';
import pg from 'pg';
import { GenericContainer } from 'testcontainers';
import { readFile } from 'node:fs/promises';
import metricsStatePg, { metricsSinkFromPool } from '../../src/infrastructure/persistence/pg/metrics.js';
import historyPg from '../../src/infrastructure/persistence/pg/history.js';

function stagedSource(time,offsets=[0,1000,5000],sample=(offset)=>{return offset;}) {
    const points=offsets.map(offset=>{return {eventId:`s${offset}`,channel:'power',time:time+offset,value:offset};});
    return ()=>{return {async registered(){},async start(){return time;},async seed(){return null;},async boundary(){return time+offsets.at(-1);},
        async page(id,left,end){const remaining=points.filter(p=>{return p.time>=left && p.time<=end;});return {from:left,until:remaining.length>2?remaining[1].time:end,next:remaining[2]?.time ?? null,end};},
        async read(id,left,right){return {items:points.filter(p=>{return p.time>=left && p.time<=right;}).map(row=>{return {...row,value:sample(row.time-time)};}),continuity:[{from:left,until:right}]};}
    };};
}
// These paging tests emulate a worker; retain already known exterior rather than submitting the old destructive payload.
async function nativeCommit(store,machine,id,rows,{snapshot,claim}) {
    const until=snapshot.context.page.until;const segments=[...rows];
    for (const owner of snapshot.segments) {
        const change=segments.find(item=>{return (item.kind??'phase')===owner.kind&&new Date(item.start_time).getTime()===new Date(owner.start_time).getTime();});
        if(change&&new Date(owner.end_time).getTime()>until&&(change.name!==owner.name||new Date(change.end_time).getTime()<new Date(owner.end_time).getTime())){
            segments.push({...owner,start_time:new Date(until+1),preserveSuffix:owner});
        }
    }
    return store.commit(machine,id,segments,{...claim,nativeTailMode:'preserve-known-suffix-v1'});
}
describe('Historical telemetry PostgreSQL', function historyTests() {
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
    it('pins a finite classifier generation while same-bucket appends get their own work',async()=>{
        const machine='finite-appends';const time=Date.now()-10000;let offsets=[0,1000,5000];
        const store=historyPg(pool,{observations:()=>{return stagedSource(time,offsets)();}});
        await store.configure(machine,[{topic:'finite/appends',channel:'power'}],30000,'casting');
        await pool.query('INSERT INTO history_work(id,machine,from_ms,until_ms) VALUES(gen_random_uuid(),$1,$2,$2)',[machine,time]);
        const original=(await store.work(machine)).items[0];
        const snapshot=await store.context(machine,original.from,original.until,0,{classifierKey:'casting',workId:original.id,workToken:original.token});
        const records=[{topic:'finite/appends',ts:time+10000,value:1}];
        await store.prepare(records);offsets=[...offsets,10000];await store.complete(records);
        await store.commit(machine,original.id,[],{...snapshot.context,revision:snapshot.revision,workToken:original.token,replace:true,checkpoint:{key:'casting',at:time+1000,state:{count:2}}});
        const remaining=(await store.work(machine)).items;
        assert.equal(remaining.find(item=>{return item.id===original.id;}).end,time+5000);
        assert(remaining.some(item=>{return item.id!==original.id && item.until===time+10000;}));
    });
    it('keeps prepared admission eligibility and registered unstarted work across a long outage',async()=>{
        const machine='aged-admission';const time=Date.now()-10000;let clock=time+29*86400000;
        const store=historyPg(pool,{now:()=>{return clock;},observations:stagedSource(time,[0])});
        await store.configure(machine,[{topic:'aged/admission',channel:'power'}],30000,'casting');
        const records=[{topic:'aged/admission',ts:time,value:1}];await store.prepare(records);
        clock+=3*86400000;await store.complete(records);
        const work=(await store.work(machine)).items[0];assert(work,'prepared input lost its correction eligibility');
        clock+=86400000;
        const snapshot=await store.context(machine,work.from,work.until,0,{classifierKey:'casting',workId:work.id,workToken:work.token});
        assert.equal(snapshot.available,true);
        await store.commit(machine,work.id,[],{...snapshot.context,revision:snapshot.revision,workToken:work.token,replace:true,checkpoint:{key:'casting',at:time,state:{count:1}}});
        assert.equal((await store.work(machine)).items.length,0);
    });
    it('classifies external raw history without copying it into PostgreSQL and fences changed external context', async () => {
        const time=Date.now()-10000;
        let value=7;
        const external=()=>{return {
            async boundary(){return time+1000;},
            async page(machine,left,end){return {from:left,until:end,next:null,end};},
            async read(){return {items:[{eventId:'external',channel:'power',time,value}],continuity:[{from:time,until:time}]};},
            async seed(){return null;}
        };};
        const store=historyPg(pool,{observations:external});
        await pool.query("DELETE FROM history_work WHERE machine='external-source'");
        await pool.query("INSERT INTO history_work(id,machine,from_ms,until_ms) VALUES(gen_random_uuid(),'external-source',$1,$1)",[time]);
        const work=(await store.work('external-source')).items[0];
        const snapshot=await store.context('external-source',time,time,1000);
        assert.equal(snapshot.items[0].value,7);
        assert.equal((await pool.query("SELECT count(*) FROM history_observations WHERE machine='external-source'")).rows[0].count,'0');
        value=8;
        await assert.rejects(store.commit('external-source',work.id,[],{...snapshot.context,revision:snapshot.revision,workToken:work.token}),/context changed/u);
        assert.equal((await store.work('external-source')).items.length,1);
        const current=await store.context('external-source',time,time,1000);
        await store.commit('external-source',work.id,[],{...current.context,revision:current.revision,workToken:work.token});
        assert.equal((await store.work('external-source')).items.length,0);
    });
    it('keeps external history unreadable until every rebatched admission has durable completion', async () => {
        const time=Date.now()-10000;
        const machine='external-admission';
        const records=[{topic:'external/admission',ts:new Date(time),value:1},{topic:'external/admission',ts:new Date(time+1000),value:2}];
        const source=()=>{return {async boundary(){return time+1000;},async page(id,left,end){return {from:left,until:end,next:null,end};},async read(){return {items:[],continuity:[]};},async seed(){return null;}};};
        const store=historyPg(pool,{observations:source});
        await pool.query('INSERT INTO history_topics(machine,topic,channel) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[machine,records[0].topic,'power']);
        await store.prepare(records);
        await assert.rejects(store.context(machine,time,time),/admission/u);
        // Restart and redelivery in different batches must resolve the same durable barriers.
        const restarted=historyPg(pool,{observations:source});
        await restarted.prepare([records[1]]);
        await restarted.complete([records[1]]);
        assert.deepEqual((await restarted.work(machine)).items,[]);
        await assert.rejects(restarted.context(machine,time,time),/admission/u);
        await restarted.prepare([records[0]]);
        await restarted.complete([records[0]]);
        assert.equal((await restarted.context(machine,time,time)).available,true);
        assert((await restarted.work(machine)).items.length>0);
        assert.equal((await pool.query('SELECT count(*) FROM history_admissions WHERE topic=$1',[records[0].topic])).rows[0].count,'0');
        assert.equal((await pool.query('SELECT count(*) FROM history_observations WHERE machine=$1',[machine])).rows[0].count,'0');
    });
    it('persists classifier checkpoints with pages and rejects commits from a replaced classifier', async () => {
        const machine='external-checkpoints';
        const time=Date.now()-10000;
        const points=[0,1000,2000,3000].map((offset)=>{return {eventId:`p${offset}`,channel:'power',time:time+offset,value:offset};});
        const external=()=>{return {
            async start(){return time;},async boundary(){return time+3000;},async seed(){return null;},
            async page(id,left,end){const remaining=points.filter(p=>{return p.time>=left && p.time<=end;});return {from:left,until:remaining.length>2?remaining[1].time:end,next:remaining[2]?.time ?? null,end};},
            async read(id,left,right){return {items:points.filter(p=>{return p.time>=left && p.time<=right;}),continuity:[{from:left,until:right}]};},
            async registered(){}
        };};
        const store=historyPg(pool,{observations:external});
        await pool.query('DELETE FROM history_work WHERE machine=$1',[machine]);
        await pool.query('DELETE FROM history_classifiers WHERE machine=$1',[machine]);
        await store.configure(machine,[{topic:'checkpoint/power',channel:'power'}],30000,'casting-v1');
        await pool.query('INSERT INTO history_work(id,machine,from_ms,until_ms) VALUES(gen_random_uuid(),$1,$2,$2)',[machine,time+2000]);
        const work=(await store.work(machine)).items[0];
        const first=await store.context(machine,work.from,work.until,0,{classifierKey:'casting-v1'});
        assert.equal(first.context.classifierKey,'casting-v1');
        assert.equal(first.page.from,time);
        await store.commit(machine,work.id,[],{...first.context,revision:first.revision,workToken:work.token,checkpoint:{key:'casting-v1',at:time+1000,state:{count:2}}});
        const restarted=historyPg(pool,{observations:external});
        const next=(await restarted.work(machine)).items[0];
        const continuation=await restarted.context(machine,next.from,next.until,0,{cursor:next.cursor,end:next.end,classifierKey:'casting-v1'});
        assert.deepEqual(continuation.classifierSeed,{at:time+1000,state:{count:2}});
        await restarted.configure(machine,[{topic:'checkpoint/power',channel:'power'}],30000,'casting-v2');
        await assert.rejects(restarted.commit(machine,next.id,[],{...continuation.context,revision:continuation.revision,workToken:next.token,checkpoint:{key:'casting-v1',at:time+3000,state:{count:4}}}),/classifier|claim/u);
        assert((await restarted.work(machine)).items.length>0);
    });
    it('invalidates late-data checkpoints and retires bounded replay only at an equal classifier state', async () => {
        const machine='checkpoint-convergence';
        const time=Math.floor(Date.now()/30000)*30000-60000;
        const points=[0,1000,2000,3000,4000,5000,6000].map(offset=>{return {eventId:`e${offset}`,channel:'power',time:time+offset,value:offset};});
        const source=()=>{return {
            async start(){return time;},async boundary(){return time+6000;},async seed(){return null;},async registered(){},
            async page(id,left,end){const remaining=points.filter(p=>{return p.time>=left && p.time<=end;});return {from:left,until:remaining.length>2?remaining[1].time:end,next:remaining[2]?.time ?? null,end};},
            async read(id,left,right){return {items:points.filter(p=>{return p.time>=left && p.time<=right;}),continuity:[{from:left,until:right}]};}
        };};
        const store=historyPg(pool,{observations:source});
        await store.configure(machine,[{topic:'convergence/power',channel:'power'}],30000,'casting');
        await pool.query('INSERT INTO history_checkpoints(machine,classifier_key,time_ms,state) VALUES($1,$2,$3,$4),($1,$2,$5,$6)',[machine,'casting',time+1000,{count:2},time+3000,{count:4}]);
        const records=[{topic:'convergence/power',ts:time+1000,value:99}];
        await store.prepare(records);await store.complete(records);
        assert((await pool.query('SELECT valid FROM history_checkpoints WHERE machine=$1',[machine])).rows.every(row=>{return row.valid===false;}));
        let work=(await store.work(machine)).items[0];
        let page=await store.context(machine,work.from,work.until,0,{classifierKey:'casting'});
        assert.equal(page.classifierSeed,null);
        await assert.rejects(store.commit(machine,work.id,[],{...page.context,revision:page.revision,workToken:work.token,checkpoint:{key:'casting',at:time,state:{count:3}}}),/checkpoint/u);
        assert.equal((await store.work(machine)).items[0].token,work.token);
        await store.commit(machine,work.id,[],{...page.context,revision:page.revision,workToken:work.token,checkpoint:{key:'casting',at:time+1000,state:{count:3}}});
        work=(await store.work(machine)).items[0];
        page=await store.context(machine,work.from,work.until,0,{cursor:work.cursor,end:work.end,classifierKey:'casting'});
        assert.deepEqual(page.classifierSeed,{at:time+1000,state:{count:3}});
        assert.equal(page.page.until,time+3000);
        assert.equal(page.page.end,time+6000);
        await store.commit(machine,work.id,[],{...page.context,revision:page.revision,workToken:work.token,checkpoint:{key:'casting',at:time+3000,state:{count:4}}});
        assert.equal((await store.work(machine)).items.length,0);
    });
    it('refuses external completion without its durable admission barrier', async () => {
        const store=historyPg(pool,{observations:()=>{return {};}});
        await assert.rejects(store.complete([{topic:'unprepared/point',ts:Date.now(),value:1}]),/prepare/u);
    });
    it('retains microsecond work coordinates while querying millisecond domain segments', async () => {
        const machine='microsecond-history';
        const time=Date.now()*1000-10000000;
        const source=()=>{return {async registered(){},async boundary(){return time+2;},async page(id,left,end){return {from:left,until:end,next:null,end};},async seed(){return null;},async read(){return {items:[{eventId:'micro1',channel:'power',time:time+1,value:1},{eventId:'micro2',channel:'power',time:time+2,value:2}],continuity:[{from:time+1,until:time+2}]};}};};
        const store=historyPg(pool,{observations:source,timeScale:1000,timestamp:(ts)=>{return Number(ts);}});
        const configured=await store.configure(machine,[{topic:'microseconds/power',channel:'power'}]);
        assert.equal(configured.timeScale,1000);
        await store.prepare([{topic:'microseconds/power',ts:String(time+1),value:1}]);
        assert.equal((await pool.query('SELECT time_ms FROM history_admissions WHERE topic=$1',['microseconds/power'])).rows[0].time_ms,String(time+1));
        await store.complete([{topic:'microseconds/power',ts:String(time+1),value:1}]);
        const work=(await store.work(machine)).items[0];
        assert.equal(work.from,time+1);
        await pool.query("INSERT INTO segments(machine,kind,name,start_time,end_time,duration) VALUES($1,'phase','on',$2,$3,1)",[machine,new Date(time/1000),new Date(time/1000+1000)]);
        const context=await store.context(machine,work.from,work.until,1000);
        assert.deepEqual(context.items.map(({time:at})=>{return at;}),[time+1,time+2]);
        assert.equal(context.segments[0].name,'on');
    });
    it('rewinds another paged classifier claim when a late admission changes its processed prefix', async () => {
        const machine='cross-work-rewind';const time=Date.now()-10000;
        const source=()=>{return {async registered(){}};};
        const store=historyPg(pool,{observations:source});
        await store.configure(machine,[{topic:'cross-work/power',channel:'power'}],30000,'casting');
        const old=await pool.query('INSERT INTO history_work(id,machine,from_ms,until_ms,cursor_ms,end_ms) VALUES(gen_random_uuid(),$1,$2,$3,$3,$4) RETURNING id,token',[machine,time,time+1000,time+9000]);
        const record={topic:'cross-work/power',ts:time+500,value:9};
        await store.prepare([record]);await store.complete([record]);
        const current=(await store.work(machine)).items.find(item=>{return item.id===old.rows[0].id;});
        assert.equal(current.cursor,null);
        assert.notEqual(current.token,old.rows[0].token);
    });
    it('keeps valid paged classifier progress when new admissions only append beyond its cursor', async () => {
        const machine='append-keeps-progress';const time=Date.now()-10000;
        const store=historyPg(pool,{observations:()=>{return {async registered(){}};}});
        await store.configure(machine,[{topic:'append-progress/power',channel:'power'}],30000,'casting');
        const old=await pool.query('INSERT INTO history_work(id,machine,from_ms,until_ms,cursor_ms,end_ms) VALUES(gen_random_uuid(),$1,$2,$3,$3,$4) RETURNING id,token',[machine,time,time+1000,time+9000]);
        const record={topic:'append-progress/power',ts:time+5000,value:9};
        await store.prepare([record]);await store.complete([record]);
        const current=(await store.work(machine)).items.find(item=>{return item.id===old.rows[0].id;});
        assert.equal(current.cursor,time+1000);
        assert.equal(current.token,old.rows[0].token);
    });
    it('publishes a complete staged casting correction atomically and applies the latest operator cuts and labels', async () => {
        const machine='staged-casting';const time=Date.now()-10000;
        const points=[0,1000,5000].map(offset=>{return {eventId:`staged${offset}`,channel:'power',time:time+offset,value:offset};});
        const source=()=>{return {async registered(){},async start(){return time;},async seed(){return null;},async boundary(){return time+5000;},
            async page(id,left,end){const remaining=points.filter(p=>{return p.time>=left && p.time<=end;});return {from:left,until:remaining.length>2?remaining[1].time:end,next:remaining[2]?.time ?? null,end};},
            async read(id,left,right){return {items:points.filter(p=>{return p.time>=left && p.time<=right;}),continuity:[{from:left,until:right}]};}
        };};
        const store=historyPg(pool,{observations:source});
        await store.configure(machine,[{topic:'staged/power',channel:'power'}],30000,'casting');
        await pool.query("INSERT INTO segments(machine,kind,name,start_time,end_time,duration,tags,properties,resolved) VALUES($1,'phase','on',$2,$3,3,$5,$7,true),($1,'phase','on',$3,$4,2,$6,$7,true)",
            [machine,new Date(time),new Date(time+3000),new Date(time+5000),'["left"]','["right"]','{"cadence_threshold_ms":"99","operator_note":"keep"}']);
        const initial=(await pool.query('SELECT start_time,end_time,tags FROM segments WHERE machine=$1 ORDER BY start_time',[machine])).rows;
        const inserted=await pool.query('INSERT INTO history_work(id,machine,from_ms,until_ms) VALUES(gen_random_uuid(),$1,$2,$3) RETURNING id',[machine,time,time+5000]);
        let work=(await store.work(machine)).items.find(row=>{return row.id===inserted.rows[0].id;});
        let context=await store.context(machine,work.from,work.until,0,{classifierKey:'casting',workId:work.id,workToken:work.token});
        const first={kind:'phase',name:'on',start_time:new Date(time+1000),end_time:new Date(time+1000),duration:0,tags:[],properties:{casting:'true',cadence_threshold_ms:'10'}};
        await store.commit(machine,work.id,[first],{...context.context,revision:context.revision,workToken:work.token,replace:true,checkpoint:{key:'casting',at:time+1000,state:{count:2}}});
        assert.deepEqual((await pool.query('SELECT start_time,end_time,tags FROM segments WHERE machine=$1 ORDER BY start_time',[machine])).rows,initial);
        assert.equal((await pool.query('SELECT count(*) FROM history_checkpoints WHERE machine=$1',[machine])).rows[0].count,'0');
        await pool.query('UPDATE segments SET consumed=false,tags=$3 WHERE machine=$1 AND start_time=$2',[machine,new Date(time+3000),'["new-right"]']);
        const continuingId=work.id;
        work=(await store.work(machine)).items.find(row=>{return row.id===continuingId;});
        context=await historyPg(pool,{observations:source}).context(machine,work.from,work.until,0,{cursor:work.cursor,end:work.end,classifierKey:'casting',workId:work.id,workToken:work.token});
        assert.deepEqual(context.classifierSeed,{at:time+1000,state:{count:2}});
        await store.commit(machine,work.id,[{...first,end_time:new Date(time+5000),duration:4}],{...context.context,revision:context.revision,workToken:work.token,replace:true,checkpoint:{key:'casting',at:time+5000,state:{count:3}}});
        const rows=(await pool.query('SELECT start_time,end_time,tags,properties,consumed FROM segments WHERE machine=$1 ORDER BY start_time',[machine])).rows;
        assert.deepEqual(rows.map(row=>{return [row.start_time.getTime()-time,row.end_time.getTime()-time,JSON.parse(row.tags)];}),[[1000,3000,['left']],[3000,5000,['new-right']]]);
        assert(rows.every(row=>{const p=JSON.parse(row.properties);return p.cadence_threshold_ms==='10' && p.operator_note==='keep';}));
        assert.equal(rows.at(-1).consumed,false);
        assert.equal((await store.work(machine)).items.length,0);
        assert.equal((await pool.query('SELECT count(*) FROM history_checkpoints WHERE machine=$1',[machine])).rows[0].count,'2');
    });
    it('converges staged replay without manufacturing a page cut or losing the unprocessed user tail', async () => {
        const machine='staged-convergence';const time=Date.now()-10000;
        const store=historyPg(pool,{observations:stagedSource(time,[0,1000,2000,3000,4000,5000,6000])});
        await store.configure(machine,[{topic:'staged-convergence/power',channel:'power'}],30000,'casting');
        await pool.query("INSERT INTO segments(machine,kind,name,start_time,end_time,duration,tags) VALUES($1,'phase','on',$2,$3,3,$5),($1,'phase','on',$3,$4,3,$6)",
            [machine,new Date(time),new Date(time+3000),new Date(time+6000),'["left"]','["right"]']);
        await pool.query('INSERT INTO history_checkpoints(machine,classifier_key,time_ms,state) VALUES($1,$2,$3,$4)',[machine,'casting',time+1000,{count:2}]);
        await pool.query('INSERT INTO history_work(id,machine,from_ms,until_ms) VALUES(gen_random_uuid(),$1,$2,$2)',[machine,time]);
        const work=(await store.work(machine)).items[0];
        const context=await store.context(machine,work.from,work.until,0,{classifierKey:'casting',workId:work.id,workToken:work.token});
        assert.equal(context.page.until,time+1000);assert.equal(context.page.end,time+6000);
        await store.commit(machine,work.id,[{name:'on',start_time:new Date(time),end_time:new Date(time+1000),duration:0,tags:[],properties:{casting:'true'}}],
            {...context.context,revision:context.revision,workToken:work.token,replace:true,checkpoint:{key:'casting',at:time+1000,state:{count:2}}});
        assert.equal((await store.work(machine)).items.length,0);
        assert.deepEqual((await pool.query('SELECT start_time,end_time,tags FROM segments WHERE machine=$1 ORDER BY start_time',[machine])).rows.map(row=>{return [row.start_time.getTime()-time,row.end_time.getTime()-time,JSON.parse(row.tags)];}),[[0,3000,['left']],[3000,6000,['right']]]);
    });
    it('removes obsolete automatic phases when the corrected casting history has no confirmed island', async () => {
        const machine='staged-empty';const time=Date.now()-10000;
        const store=historyPg(pool,{observations:stagedSource(time,[0,5000])});
        await store.configure(machine,[{topic:'staged-empty/power',channel:'power'}],30000,'casting');
        await pool.query("INSERT INTO segments(machine,kind,name,start_time,end_time,duration,tags) VALUES($1,'phase','on',$2,$3,0,$4)",[machine,new Date(time),new Date(time+5000),JSON.stringify(['keep'])]);
        await pool.query('INSERT INTO history_work(id,machine,from_ms,until_ms) VALUES(gen_random_uuid(),$1,$2,$3)',[machine,time,time+5000]);
        const work=(await store.work(machine)).items[0];
        const context=await store.context(machine,work.from,work.until,0,{classifierKey:'casting',workId:work.id,workToken:work.token});
        await store.commit(machine,work.id,[],{...context.context,revision:context.revision,workToken:work.token,replace:true,checkpoint:{key:'casting',at:time+5000,state:{last:null}}});
        assert.equal((await pool.query('SELECT count(*) FROM segments WHERE machine=$1',[machine])).rows[0].count,'0');
        assert.equal((await pool.query('SELECT tags FROM history_annotations WHERE machine=$1',[machine])).rows[0].tags,'["keep"]');
    });
    it('keeps a real user cut at the last singleton without leaving the preceding slice pending', async () => {
        const machine='staged-final-cut';const time=Date.now()-10000;
        const store=historyPg(pool,{observations:stagedSource(time,[0,5000])});
        await store.configure(machine,[{topic:'staged-final-cut/power',channel:'power'}],30000,'casting');
        await pool.query("INSERT INTO segments(machine,kind,name,start_time,end_time,duration,tags,properties) VALUES($1,'phase','on',$2,$3,5,$4,$6),($1,'phase','on',$3,$3,0,$5,$6)",
            [machine,new Date(time),new Date(time+5000),'["left"]','["singleton"]','{"cadence_rule":"old","note":"keep"}']);
        await pool.query('INSERT INTO history_work(id,machine,from_ms,until_ms) VALUES(gen_random_uuid(),$1,$2,$3)',[machine,time,time+5000]);
        const work=(await store.work(machine)).items[0];
        const context=await store.context(machine,work.from,work.until,0,{classifierKey:'casting',workId:work.id,workToken:work.token});
        await store.commit(machine,work.id,[{name:'on',start_time:new Date(time),end_time:new Date(time+5000),duration:0,tags:[],properties:{casting:'true',cadence_rule:'fresh'}}],
            {...context.context,revision:context.revision,workToken:work.token,replace:true,checkpoint:{key:'casting',at:time+5000,state:{count:2}}});
        const rows=(await pool.query('SELECT start_time,duration,tags,properties FROM segments WHERE machine=$1 ORDER BY start_time',[machine])).rows;
        assert.deepEqual(rows.map(row=>{return [row.start_time.getTime()-time,row.duration,JSON.parse(row.tags)];}),[[0,5,['left']],[5000,0,['singleton']]]);
        assert(rows.every(row=>{const p=JSON.parse(row.properties);return p.cadence_rule==='fresh' && p.note==='keep';}));
    });
    it('does not advance staged work when a nonempty page omits its classifier checkpoint', async () => {
        const machine='staged-missing-state';const time=Date.now()-10000;
        const store=historyPg(pool,{observations:stagedSource(time)});
        await store.configure(machine,[{topic:'staged-missing-state/power',channel:'power'}],30000,'casting');
        await pool.query('INSERT INTO history_work(id,machine,from_ms,until_ms) VALUES(gen_random_uuid(),$1,$2,$3)',[machine,time,time+5000]);
        const work=(await store.work(machine)).items[0];
        const context=await store.context(machine,work.from,work.until,0,{classifierKey:'casting',workId:work.id,workToken:work.token});
        await assert.rejects(store.commit(machine,work.id,[],{...context.context,revision:context.revision,workToken:work.token,replace:true}),/checkpoint/u);
        assert.equal((await store.work(machine)).items[0].cursor,null);
    });
    it('discards an obsolete staged generation after a late point rewinds its processed prefix', async () => {
        const machine='staged-rewind';const time=Date.now()-10000;let changed=false;
        const store=historyPg(pool,{observations:stagedSource(time,[0,1000,5000],offset=>{return changed && offset===0?99:offset;})});
        await store.configure(machine,[{topic:'staged-rewind/power',channel:'power'}],30000,'casting');
        await pool.query("INSERT INTO segments(machine,kind,name,start_time,end_time,duration) VALUES($1,'phase','on',$2,$3,0)",[machine,new Date(time),new Date(time+5000)]);
        const inserted=(await pool.query('INSERT INTO history_work(id,machine,from_ms,until_ms) VALUES(gen_random_uuid(),$1,$2,$3) RETURNING id',[machine,time,time+5000])).rows[0];
        let work=(await store.work(machine)).items.find(row=>{return row.id===inserted.id;});
        let context=await store.context(machine,work.from,work.until,0,{classifierKey:'casting',workId:work.id,workToken:work.token});
        const oldClaim={...context.context,revision:context.revision,workToken:work.token,replace:true,checkpoint:{key:'casting',at:time+1000,state:{count:2}}};
        await store.commit(machine,work.id,[{name:'on',start_time:new Date(time+1000),end_time:new Date(time+1000),duration:0,tags:[]}],oldClaim);
        const records=[{topic:'staged-rewind/power',ts:time,value:99}];
        await store.prepare(records);changed=true;await store.complete(records);
        await assert.rejects(store.commit(machine,inserted.id,[],oldClaim),/claim/u);
        work=(await store.work(machine)).items.find(row=>{return row.id===inserted.id;});
        assert.equal(work.cursor,null);
        context=await store.context(machine,work.from,work.until,0,{classifierKey:'casting',workId:work.id,workToken:work.token});
        assert.equal(context.classifierSeed,null);
        await store.commit(machine,work.id,[{name:'off',start_time:new Date(time),end_time:new Date(time+1000),duration:0,tags:[]}],
            {...context.context,revision:context.revision,workToken:work.token,replace:true,checkpoint:{key:'casting',at:time+1000,state:{mode:'off',count:2}}});
        work=(await store.work(machine)).items.find(row=>{return row.id===inserted.id;});
        context=await store.context(machine,work.from,work.until,0,{classifierKey:'casting',workId:work.id,workToken:work.token,cursor:work.cursor,end:work.end});
        await store.commit(machine,work.id,[{name:'off',start_time:new Date(time),end_time:new Date(time+5000),duration:0,tags:[]}],
            {...context.context,revision:context.revision,workToken:work.token,replace:true,checkpoint:{key:'casting',at:time+5000,state:{mode:'off',count:3}}});
        const rows=(await pool.query('SELECT name,start_time,end_time FROM segments WHERE machine=$1 ORDER BY start_time',[machine])).rows;
        assert.deepEqual(rows.map(row=>{return [row.name,row.start_time.getTime()-time,row.end_time.getTime()-time];}),[['off',0,5000]]);
        assert.equal((await pool.query('SELECT count(*) FROM history_corrections WHERE machine=$1',[machine])).rows[0].count,'0');
    });
    it('keeps first local metric before history registration and across receiver restarts', async () => {
        const topic = 'first-wins/power';
        const ts = Date.now() - 1000;
        const first = metricsSinkFromPool(pool, { firstWins: true });
        await first.write([{ topic, ts, value: 11 }]);
        await metricsSinkFromPool(pool, { firstWins: true }).write([{ topic, ts, value: 99 }]);
        await historyPg(pool).configure('first-wins', [{ topic, channel: 'power' }]);
        await Promise.all([first.write([{ topic, ts, value: 33 }]), first.write([{ topic, ts, value: 44 }])]);
        assert.equal((await metricsStatePg(pool).latestForTopic(topic)).value, 11);
        assert.deepEqual((await pool.query('SELECT value FROM metrics WHERE topic=$1', [topic])).rows, [{ value: 11 }]);
        assert.equal((await historyPg(pool).context('first-wins', ts, ts)).items[0].value, 11);
    });
    it('retains receipts while raw metrics remain and expires only beyond history retention', async () => {
        const sink = metricsSinkFromPool(pool, { firstWins: true });
        const old = Date.now() - 40 * 86400000;
        const recent = Date.now() - 86400000;
        await sink.write([{topic:'receipt-retention',ts:old,value:1},{topic:'receipt-retention',ts:recent,value:2}]);
        await historyPg(pool).purge();
        assert.equal((await pool.query("SELECT count(*) FROM metric_receipts WHERE topic='receipt-retention'")).rows[0].count,'2');
        await pool.query("DELETE FROM metrics WHERE topic='receipt-retention'");
        await historyPg(pool).purge();
        assert.deepEqual((await pool.query("SELECT value FROM metric_receipts WHERE topic='receipt-retention'")).rows,[{value:2}]);
    });
    it('preserves existing raw metrics when first-wins is enabled later', async () => {
        const topic='legacy-receipt'; const ts=Date.now()-1000;
        await metricsSinkFromPool(pool).write([{topic,ts,value:7}]);
        await metricsSinkFromPool(pool,{firstWins:true}).write([{topic,ts,value:77}]);
        assert.deepEqual((await pool.query('SELECT value FROM metrics WHERE topic=$1',[topic])).rows,[{value:7}]);
    });
    it('atomically accepts first value, ignores conflicts and records persistent work', async () => {
        const store = historyPg(pool);
        const time = Math.floor(Date.now()/30000)*30000-90000;
        await store.accept('m1', [{ eventId: 'a', channel: 'power', time, value: 1 }]);
        await store.accept('m1', [{ eventId: 'b', channel: 'power', time, value: 2 }]);
        const context = await store.context('m1', time, time);
        assert.equal(context.items.length, 1); assert.equal(context.items[0].value, 1);
        const work = await store.work('m1'); assert.equal(work.items.length, 1);
        await store.commit('m1', work.items[0].id, [], {workToken:work.items[0].token,from:time,until:time});
        assert.equal((await store.work('m1')).items.length, 0);
        await store.commit('m1', work.items[0].id, [], {workToken:work.items[0].token,from:time,until:time});
    });
    it('does not schedule classification for out-of-history telemetry', async () => {
        const store = historyPg(pool);
        const time = Date.now() - 31 * 86400000;
        await store.accept('m2', [{ eventId: 'old', channel: 'power', time, value: 1 }]);
        assert.equal((await store.context('m2', time, time)).available, false);
        assert.equal((await store.work('m2')).items.length, 0);
    });
    it('keeps work pending when an operator changes the context during classification', async () => {
        const store = historyPg(pool);
        const time = Math.floor(Date.now()/30000)*30000-120000;
        await pool.query("INSERT INTO segments(machine,kind,name,start_time,end_time,duration) VALUES('race','phase','off',$1,$2,1)", [new Date(time), new Date(time+1000)]);
        await store.accept('race', [{eventId:'race',channel:'power',time,value:0}]);
        const context = await store.context('race',time,time+1000);
        const work = (await store.work('race')).items[0];
        await pool.query("UPDATE segments SET tags='[\"manual\"]' WHERE machine='race'");
        await assert.rejects(store.commit('race',work.id,context.segments,{...context.context,revision:context.revision,workToken:work.token}), /context changed/u);
        assert.equal((await store.work('race')).items.length,1);
        assert.equal((await pool.query("SELECT tags FROM segments WHERE machine='race'")).rows[0].tags,'["manual"]');
    });

    it('creates historical work atomically when persisted telemetry arrives without supervisor', async () => {
        const store = historyPg(pool);
        await store.configure('offline', [{topic:'MX210/icht-1/GET/AI3/VALUE',channel:'power'}]);
        const time=Math.floor(Date.now()/30000)*30000-150000;
        await pool.query('INSERT INTO metrics(topic,ts,value) VALUES($1,$2,$3)', ['MX210/icht-1/GET/AI3/VALUE',new Date(time),5]);
        assert.equal((await store.work('offline')).items.length,1);
        assert.equal((await store.context('offline',time,time)).items[0].value,5);
    });

    it('rejects stale work claims after the bucket was expanded or recreated', async () => {
        const store = historyPg(pool);
        await store.configure('claim', [{topic:'claim/power',channel:'power'}],30000);
        const time=Math.floor(Date.now()/30000)*30000-180000;
        await pool.query('INSERT INTO metrics VALUES($1,$2,$3)', ['claim/power',new Date(time),1]);
        const first=(await store.work('claim')).items[0];
        await pool.query('INSERT INTO metrics VALUES($1,$2,$3)', ['claim/power',new Date(time+25000),2]);
        await assert.rejects(store.commit('claim',first.id,[],{workToken:first.token,from:time,until:time}),/claim changed/u);
        const expanded=(await store.work('claim')).items[0];
        await store.commit('claim',expanded.id,[],{workToken:expanded.token,from:time,until:time+25000});
        await pool.query('INSERT INTO metrics VALUES($1,$2,$3)', ['claim/power',new Date(time+26000),3]);
        await assert.rejects(store.commit('claim',expanded.id,[],{workToken:expanded.token,from:time,until:time+25000}),/claim changed/u);
        assert.equal((await store.work('claim')).items.length,1);
    });
    it('retains predecessor parameter values across continuous other-channel updates', async () => {
        const store=historyPg(pool);
        const time=Date.now()-30000;
        const points=[{eventId:'speed',channel:'speed',time,value:1},...[5,10,15,20,25,30].map((seconds)=>{return {eventId:`beat${seconds}`,channel:'beat',time:time+seconds*1000,value:1};})];
        await store.accept('seed',points);
        const context=await store.context('seed',time+25000,time+25000,10000);
        assert.equal(context.initial.values.speed,1);
        assert.equal(context.initial.time,time+10000);
    });

    it('compacts unchanged heartbeats without truncating the affected existing segment', async () => {
        const store=historyPg(pool);
        const time=Date.now()-1100000;
        await pool.query("INSERT INTO segments(machine,kind,name,start_time,end_time,duration) VALUES('long','phase','running',$1,$2,1000)", [new Date(time),new Date(time+1000000)]);
        await pool.query(`INSERT INTO history_observations(machine,channel,time_ms,event_id,value)
            SELECT 'long','beat',$1::bigint+n*5000,'longbeat'||n,1 FROM generate_series(0,200) n`,[time]);
        await store.accept('long',[{eventId:'longspeed0',channel:'speed',time,value:1},{eventId:'late',channel:'speed',time:time+25000,value:0}]);
        const context=await store.context('long',time+25000,time+25000,10000);
        assert.equal(context.items.at(-1).time,time+1000000);
        assert.ok(context.items.length<15);
        assert.deepEqual(context.continuity,[{from:time+15000,until:time+1000000}]);
        assert.ok(context.items.some((point)=>{return point.time===time+20000;}));
    });

    it('preserves first values of each channel after a real continuity reset', async () => {
        const store=historyPg(pool); const time=Date.now()-200000;
        const points=[[0,'a',1],[100,'b',1],[101,'a',1],[102,'b',1],[103,'a',2],[104,'b',1]].map(([seconds,channel,value])=>{return {eventId:`gap${channel}${seconds}`,channel,time:time+seconds*1000,value};});
        await store.accept('gap',points);
        const context=await store.context('gap',time,time+104000,10000);
        assert.ok(context.items.some((point)=>{return point.channel==='a'&&point.time===time+101000&&point.value===1;}));
        assert.equal(context.continuity.length,2);
    });
    it('follows carried parameters across user cuts and neutral later values', async () => {
        const store=historyPg(pool); const time=Date.now()-1100000;
        await pool.query(`INSERT INTO segments(machine,kind,name,start_time,end_time,duration) VALUES
            ('hysteresis','phase','off',$1,$2,50),('hysteresis','phase','off',$2,$3,950)`,[new Date(time),new Date(time+50000),new Date(time+1000000)]);
        await pool.query(`INSERT INTO history_observations(machine,channel,time_ms,event_id,value) SELECT 'hysteresis','beat',$1::bigint+n*5000,'hystbeat'||n,1 FROM generate_series(0,200) n`,[time]);
        const points=[[0,'a',0],[25,'a',10],[30,'a',3],[1000,'beat',1]].map(([seconds,channel,value])=>{return {eventId:`hyst${channel}${seconds}`,channel,time:time+seconds*1000,value};});
        await store.accept('hysteresis',points);
        const context=await store.context('hysteresis',time+25000,time+25000,10000);
        assert.equal(context.items.at(-1).time,time+1000000);
    });

    it('tracks indirectly restored parameters when late data bridges an old gap', async () => {
        const store=historyPg(pool); const time=Date.now()-1100000;
        await pool.query(`INSERT INTO segments(machine,kind,name,start_time,end_time,duration) VALUES
            ('bridge','phase','cold',$1,$2,35),('bridge','phase','idle',$3,$4,945)`,[new Date(time+14000),new Date(time+49000),new Date(time+54000),new Date(time+999000)]);
        await pool.query(`INSERT INTO history_observations(machine,channel,time_ms,event_id,value)
            SELECT 'bridge','b',$1::bigint+14000+n*5000,'bridgebeat'||n,CASE WHEN n<8 THEN 1 ELSE 2 END FROM generate_series(0,197) n`,[time]);
        await store.accept('bridge',[{eventId:'originalA',channel:'a',time,value:1},{eventId:'bridge',channel:'b',time:time+7000,value:1}]);
        const context=await store.context('bridge',time+7000,time+7000,10000);
        assert.equal(context.items.at(-1).time,time+999000);
        assert.equal(context.continuity.length,1);
        assert.ok(context.items.some((point)=>{return point.channel==='a'&&point.value===1;}));
    });

    it('supports the existing receiver role with only required local history privileges', async () => {
        await pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supervisor_sink') THEN CREATE ROLE supervisor_sink; END IF; END $$");
        await pool.query('GRANT SELECT, INSERT ON metrics TO supervisor_sink');
        await pool.query(await readFile(new URL('../../db/migrations/E0005__historical_telemetry_grants.sql', import.meta.url),'utf8'));
        await pool.query(await readFile(new URL('../../db/migrations/E0008__metric_receipts_grants.sql', import.meta.url),'utf8'));
        await pool.query(await readFile(new URL('../../db/migrations/E0012__external_history_grants.sql', import.meta.url),'utf8'));
        await pool.query(await readFile(new URL('../../db/migrations/E0014__history_correction_grants.sql', import.meta.url),'utf8'));
        await pool.query(await readFile(new URL('../../db/migrations/E0016__history_retention_grants.sql', import.meta.url),'utf8'));
        const client=await pool.connect();
        try {
            await client.query('SET ROLE supervisor_sink');
            assert.equal((await client.query('SELECT count(*) FROM history_work')).rowCount,1);
            await metricsSinkFromPool(client,{firstWins:true}).write([{topic:'role/metric',ts:Date.now(),value:1}]);
            await client.query("INSERT INTO history_topics(machine,topic,channel) VALUES('role','role/topic','value')");
            await client.query("INSERT INTO history_admissions(event_id,topic,time_ms) VALUES('role-event','role/topic',1)");
            await assert.rejects(historyPg(client,{observations:()=>{return {};}}).context('role',1,1),/admission/u);
            await client.query("INSERT INTO history_classifiers(machine,classifier_key) VALUES('role','casting')");
            await client.query("INSERT INTO history_checkpoints(machine,classifier_key,time_ms,state) VALUES('role','casting',1,'{}')");
            await client.query("UPDATE history_checkpoints SET valid=false WHERE machine='role'");
            await client.query("DELETE FROM history_admissions WHERE event_id='role-event'");
            const rolePool={query:client.query.bind(client),async connect(){return {query:client.query.bind(client),release(){}};}};
            const roleHistory=historyPg(rolePool,{observations:()=>{return {};}});
            const delivered=[{topic:'role/topic',ts:Date.now(),value:7}];
            await roleHistory.prepare(delivered);await roleHistory.complete(delivered);
            const at=Date.now();
            const staged=(await client.query("INSERT INTO history_work(id,machine,from_ms,until_ms,correction_from,correction_until) VALUES(gen_random_uuid(),'role-stage',$1,$2,$1,$2) RETURNING id,generation",[at,at+1000])).rows[0];
            await client.query("INSERT INTO history_corrections(work_id,generation,machine,kind,name,start_time,end_time,duration) VALUES($1,$2,'role-stage','phase','on',$3,$4,1)",[staged.id,staged.generation,new Date(at),new Date(at+1000)]);
            await client.query("SELECT history_apply_correction($1,'role-stage',1,false)",[staged.id]);
            assert.equal((await client.query("SELECT count(*) FROM segments WHERE machine='role-stage'")).rows[0].count,'1');
            await client.query('DELETE FROM history_work WHERE id=$1',[staged.id]);
        } finally { await client.query('RESET ROLE'); client.release(); }
    });

    it('refreshes pending segment write time for the existing silence watchdog', async () => {
        const store=historyPg(pool); const time=Math.floor(Date.now()/30000)*30000-210000;
        await pool.query("INSERT INTO segments(machine,kind,name,start_time,end_time,duration,updated_at) VALUES('fresh','phase','off',$1,$2,0,now()-interval '1 hour')",[new Date(time),new Date(time+1000)]);
        await store.accept('fresh',[{eventId:'fresh',channel:'a',time,value:0}]);
        const work=(await store.work('fresh')).items[0]; const context=await store.context('fresh',time,time);
        await store.commit('fresh',work.id,context.segments,{...context.context,revision:context.revision,workToken:work.token});
        assert.ok(Date.now()-new Date((await pool.query("SELECT updated_at FROM segments WHERE machine='fresh'")).rows[0].updated_at).getTime()<5000);
    });

    it('imports already persisted telemetry on first topic registration without duplicate work on restart', async () => {
        const store=historyPg(pool); const time=Math.floor(Date.now()/30000)*30000-240000;
        await pool.query('INSERT INTO metrics VALUES($1,$2,$3)',['before/config',new Date(time),8]);
        await store.configure('bootstrap',[{topic:'before/config',channel:'a'}]);
        assert.equal((await store.context('bootstrap',time,time)).items[0].value,8);
        const first=(await store.work('bootstrap')).items;
        await store.configure('bootstrap',[{topic:'before/config',channel:'a'}]);
        assert.deepEqual((await store.work('bootstrap')).items,first);
    });

    it('prioritizes current classification over a bounded historical batch', async () => {
        const store=historyPg(pool); const now=Date.now();
        const points=Array.from({length:12},(item,index)=>{return {eventId:`priority${index}`,channel:'a',time:now-(12-index)*60000,value:index};});
        await store.accept('priority',points);
        await store.accept('priority',[{eventId:'latest',channel:'a',time:now,value:20}]);
        const work=(await store.work('priority')).items;
        assert.equal(work.length,8); assert.equal(work[0].until,now-60000);
    });

    it('durably pages more than 10000 changing observations with restart, response loss and context CAS', async () => {
        const machine='paged'; const time=Math.floor((Date.now()-20000000)/30000)*30000+10000;
        await pool.query(`INSERT INTO history_observations(machine,channel,time_ms,event_id,value)
            SELECT $1,'power',$2::bigint+n*1000+CASE WHEN n>=6000 THEN 30000 ELSE 0 END,'page-power-'||n,n%2 FROM generate_series(0,12000) n`,[machine,time]);
        await pool.query(`INSERT INTO segments(machine,kind,name,start_time,end_time,duration,tags) VALUES($1,'phase','off',$2,$3,12000,'["repair"]')`,[machine,new Date(time),new Date(time+12030000)]);
        let store=historyPg(pool);
        await store.accept(machine,[{eventId:'carried',channel:'carried',time:time-1000,value:5}]);
        let work=(await store.work(machine)).items[0];
        let context=await store.context(machine,work.from,work.until,2000);
        assert.equal(context.rightClosed,false);
        assert.ok(context.context.page.next>time);
        assert.ok(context.items.length<=500);
        await assert.rejects(store.commit(machine,work.id,[{name:'off',start_time:new Date(time),end_time:new Date(time+12000000)}],{...context.context,revision:context.revision,workToken:work.token}),/beyond bounded/u);
        const firstClaim={...context.context,revision:context.revision,workToken:work.token};
        await store.commit(machine,work.id,[],firstClaim);
        await assert.rejects(store.commit(machine,work.id,[],firstClaim),(error)=>{return error.statusCode===409;});
        // A newly accepted point invalidates durable progress and the outstanding token.
        await store.accept(machine,[{eventId:'late-carried',channel:'carried',time:time-500,value:7}]);
        store=historyPg(pool);
        work=(await store.work(machine)).items[0];
        assert.equal(work.cursor,null);
        const seen=new Set(); let pages=0;
        /* eslint-disable no-await-in-loop -- Durable page sequencing is the behavior under test. */
        while ((await store.work(machine)).items.length) {
            work=(await store.work(machine)).items[0];
            context=await store.context(machine,work.from,work.until,2000,{cursor:work.cursor,end:work.end});
            assert.ok(context.items.length<=500);
            if (work.cursor!==null && work.cursor<time+6030000) { assert.equal(context.initial.values.carried,7); }
            if (work.cursor>time+6030000) { assert.equal(context.initial.values.carried,undefined); }
            const points=context.items.filter((point)=>{return point.channel==='power';});
            points.forEach((point)=>{seen.add(point.time);});
            const rows=points.map((point)=>{return {kind:'phase',name:point.value===0?'off':'heat',start_time:new Date(point.time).toISOString(),end_time:new Date(point.time).toISOString(),duration:0};});
            const claim={...context.context,revision:context.revision,workToken:work.token};
            if (pages===1) {
                await pool.query(`UPDATE segments SET tags='["manual-cut"]' WHERE machine=$1`,[machine]);
                await assert.rejects(store.commit(machine,work.id,rows,claim),(error)=>{return error.statusCode===409;});
                context=await store.context(machine,work.from,work.until,2000,{cursor:work.cursor,end:work.end});
            }
            await nativeCommit(store,machine,work.id,rows,{snapshot:context,claim:{...context.context,revision:context.revision,workToken:work.token}});
            // Restart loses all application memory between every page.
            store=historyPg(pool);
            pages+=1;
            assert.ok(pages<60);
        }
        /* eslint-enable no-await-in-loop */
        const original=(await pool.query('SELECT end_time,tags FROM history_annotations WHERE machine=$1 AND start_time=$2',[machine,new Date(time)])).rows[0];
        assert.equal(original.end_time.getTime(),time+12030000);
        assert.equal(seen.size,12001);
        const projected=(await pool.query('SELECT start_time FROM segments WHERE machine=$1',[machine])).rows;
        const keys=new Set(projected.map(row=>{return row.start_time.getTime();}));
        for(const point of seen){assert.ok(keys.has(point),'every observed classification remains projected');}
        assert.ok(projected.length>=12001);
        assert.ok(pages>40);
    });

    it('finishes only persisted continuation after retention boundary and receiver restart', async () => {
        const machine='retention-page'; const start=Date.now()-30*86400000+1000;
        let clock=start+30*86400000-500;
        let store=historyPg(pool,{now:()=>{return clock;}});
        await pool.query(`INSERT INTO history_observations(machine,channel,time_ms,event_id,value) SELECT $1,'power',$2::bigint+n*1000,'retention-page-'||n,n%2 FROM generate_series(0,600) n`,[machine,start]);
        await store.accept(machine,[{eventId:'retention-carry',channel:'carry',time:start,value:7}]);
        let work=(await store.work(machine)).items[0];
        let snapshot=await store.context(machine,work.from,work.until,1000);
        await store.commit(machine,work.id,[],{...snapshot.context,revision:snapshot.revision,workToken:work.token});
        clock+=60000;
        await store.purge();
        store=historyPg(pool,{now:()=>{return clock;}});
        assert.equal((await store.context(machine,work.from,work.until,1000)).available,false);
        assert.equal((await store.context(machine,work.from,work.until,1000,{cursor:start+1,end:start+600000})).available,false);
        /* eslint-disable no-await-in-loop -- Persisted restart pages must finish serially. */
        while ((await store.work(machine)).items.length) {
            work=(await store.work(machine)).items[0];
            snapshot=await store.context(machine,work.from,work.until,1000,{cursor:work.cursor,end:work.end});
            assert.equal(snapshot.available,true);
            assert.ok(snapshot.items.length>0);
            assert.equal(snapshot.initial.values.carry,7);
            await store.commit(machine,work.id,[],{...snapshot.context,revision:snapshot.revision,workToken:work.token});
        }
        /* eslint-enable no-await-in-loop */
    });

    it('pages dense multi-channel timestamps without splitting a timestamp group', async () => {
        const machine='dense-page'; const time=Date.now()-200000;
        await pool.query(`INSERT INTO history_observations(machine,channel,time_ms,event_id,value)
            SELECT $1,'channel-'||c,$2::bigint+n*1000,'dense-'||c||'-'||n,n%2 FROM generate_series(0,100) n CROSS JOIN generate_series(1,100) c`,[machine,time]);
        const store=historyPg(pool);
        await store.accept(machine,[{eventId:'dense-carry',channel:'carry',time:time-1000,value:7}]);
        const work=(await store.work(machine)).items[0];
        const snapshot=await store.context(machine,work.from,work.until,1000);
        assert.ok(snapshot.items.length<=10000);
        assert.ok(snapshot.context.page.next!==null);
        const last=snapshot.items.at(-1).time;
        assert.equal(snapshot.items.filter((point)=>{return point.time===last;}).length,100);
        assert.equal(snapshot.context.page.next,last+1000);
    });

    it('does not retire a paged correction after it overwrites a newer live tail', async () => {
        const machine='live-page'; const time=Math.floor((Date.now()-20000000)/30000)*30000;
        const store=historyPg(pool);
        await pool.query(`INSERT INTO history_observations(machine,channel,time_ms,event_id,value) SELECT $1,'power',$2::bigint+n*1000,'live-page-'||n,CASE WHEN n=0 THEN 0 ELSE 5 END FROM generate_series(0,10001) n WHERE n<>1`,[machine,time]);
        await pool.query(`INSERT INTO segments(machine,kind,name,start_time,end_time,duration) VALUES($1,'phase','off',$2,$3,7000),($1,'phase','off',$3,$4,0)`,[machine,new Date(time),new Date(time+7000000),new Date(time+10001000)]);
        await store.accept(machine,[{eventId:'late-heat',channel:'power',time:time+1000,value:20}]);
        const original=(await store.work(machine)).items[0];
        let work=original;
        let snapshot=await store.context(machine,work.from,work.until,2000);
        let sawLive=false;
        function heatRows(context) {
            const page=context.context.page;
            const live=context.items.some((point)=>{return point.time===time+10002000&&point.value===0;});
            sawLive ||= live;
            const cut=time+7000000;
            const end=live ? time+10001000 : page.until;
            const ranges=end<=cut ? [[time+1000,end]] : [[time+1000,cut],[cut,end]];
            const rows=ranges.map(([start,finish])=>{return {name:'heat',start_time:new Date(start),end_time:new Date(finish),duration:0};});
            if (live) { rows.push({name:'off',start_time:new Date(time+10002000),end_time:new Date(time+10002000),duration:0}); }
            return rows;
        }
        await nativeCommit(store,machine,work.id,heatRows(snapshot),{snapshot,claim:{...snapshot.context,revision:snapshot.revision,workToken:work.token}});
        await store.accept(machine,[{eventId:'live-off',channel:'power',time:time+10002000,value:0}]);
        const live=(await store.work(machine)).items.find((item)=>{return item.id!==original.id;});
        const current=await store.context(machine,live.from,live.until,2000);
        await store.commit(machine,live.id,[{name:'off',start_time:new Date(time+7000000),end_time:new Date(time+10002000),duration:0}],{...current.context,revision:current.revision,workToken:live.token});
        /* eslint-disable no-await-in-loop -- Reproduce live work overtaking the historical continuation. */
        do {
            work=(await store.work(machine)).items.find((item)=>{return item.id===original.id;});
            snapshot=await store.context(machine,work.from,work.until,2000,{cursor:work.cursor,end:work.end});
            await nativeCommit(store,machine,work.id,heatRows(snapshot),{snapshot,claim:{...snapshot.context,revision:snapshot.revision,workToken:work.token}});
        } while (snapshot.context.page.next!==null);
        /* eslint-enable no-await-in-loop */
        assert.equal((await store.work(machine)).items.length,0);
        assert.ok(sawLive,'final correction must classify the already-processed live observation');
        const off=await pool.query('SELECT name FROM segments WHERE machine=$1 AND start_time=$2',[machine,new Date(time+10002000)]);
        assert.equal(off.rows[0]?.name,'off');
    });
    it('recomputes carried multi-channel dependencies beyond a new live kind boundary', async () => {
        const machine='composite-live-page'; const time=Math.floor((Date.now()-20000000)/30000)*30000;
        const store=historyPg(pool);
        await pool.query(`INSERT INTO history_observations(machine,channel,time_ms,event_id,value) SELECT $1,'power',$2::bigint+n*1000,'live-page-'||n,CASE WHEN n=0 THEN 0 ELSE 5 END FROM generate_series(0,10001) n WHERE n<>1`,[machine,time]);
        await pool.query(`INSERT INTO segments(machine,kind,name,start_time,end_time,duration) VALUES($1,'phase','off',$2,$3,7000),($1,'phase','off',$3,$4,0)`,[machine,new Date(time),new Date(time+7000000),new Date(time+10001000)]);
        await pool.query(`INSERT INTO history_observations(machine,channel,time_ms,event_id,value) VALUES($1,'temperature',$2,'old-temp',10)`,[machine,time]);
        await store.accept(machine,[{eventId:'late-temp',channel:'temperature',time:time+1000,value:100}]);
        const original=(await store.work(machine)).items[0];
        let work=original;
        let snapshot=await store.context(machine,work.from,work.until,2000);
        let sawLive=false;
        function heatRows(context) {
            const page=context.context.page;
            const live=context.items.some((point)=>{return point.time===time+10003000&&point.value===0;});
            sawLive ||= live;
            const cut=time+7000000;
            const end=page.until;
            const ranges=end<=cut ? [[time+1000,end]] : [[time+1000,cut],[cut,end]];
            const rows=ranges.map(([start,finish])=>{return {name:'heat',start_time:new Date(start),end_time:new Date(finish),duration:0};});
            if (live) {
                rows.splice(1,1,{name:'heat',start_time:new Date(cut),end_time:new Date(time+10002000),duration:0},{name:'heat',start_time:new Date(time+10002000),end_time:new Date(time+10003000),duration:0},{name:'heat',start_time:new Date(time+10003000),end_time:new Date(time+10003000),duration:0});
            }
            return rows;
        }
        await nativeCommit(store,machine,work.id,heatRows(snapshot),{snapshot,claim:{...snapshot.context,revision:snapshot.revision,workToken:work.token}});
        await store.accept(machine,[{eventId:'live-heat',channel:'power',time:time+10002000,value:20},{eventId:'live-off',channel:'power',time:time+10003000,value:0}]);
        const live=(await store.work(machine)).items.find((item)=>{return item.id!==original.id;});
        const current=await store.context(machine,live.from,live.until,2000);
        await store.commit(machine,live.id,[{name:'heat',start_time:new Date(time+10002000),end_time:new Date(time+10002000),duration:0},{name:'off',start_time:new Date(time+10003000),end_time:new Date(time+10003000),duration:0}],{...current.context,revision:current.revision,workToken:live.token});
        /* eslint-disable no-await-in-loop -- Reproduce live work overtaking the historical continuation. */
        do {
            work=(await store.work(machine)).items.find((item)=>{return item.id===original.id;});
            snapshot=await store.context(machine,work.from,work.until,2000,{cursor:work.cursor,end:work.end});
            await nativeCommit(store,machine,work.id,heatRows(snapshot),{snapshot,claim:{...snapshot.context,revision:snapshot.revision,workToken:work.token}});
        } while (snapshot.context.page.next!==null);
        /* eslint-enable no-await-in-loop */
        assert.equal((await store.work(machine)).items.length,0);
        assert.ok(sawLive,'final correction must classify the already-processed live observation');
        const off=await pool.query('SELECT name FROM segments WHERE machine=$1 AND start_time=$2',[machine,new Date(time+10003000)]);
        assert.equal(off.rows[0]?.name,'heat');
    });

    it('withholds the furnace bucket that is still receiving observations', async () => {
        const machine='открытый-бакет';
        const store=historyPg(pool);
        await store.configure(machine,[{topic:'открытый/бакет',channel:'power'}],30000);
        const now=Number((await pool.query(`SELECT floor(extract(epoch FROM clock_timestamp())*1000) AS ms`)).rows[0].ms);
        const open=Math.floor(now/30000)*30000+1500;
        const closed=open-30000;
        await store.accept(machine,[
            {eventId:`закрытый-${closed}`,channel:'power',time:closed,value:3.5},
            {eventId:`открытый-${open}`,channel:'power',time:open,value:4.5}
        ]);
        const offered=(await store.work(machine)).items.some((item)=>{return item.until>=Math.floor(now/30000)*30000;});
        assert.equal(offered,false,'open furnace bucket was handed to the worker');
    });

    it('offers a furnace bucket once its window has closed', async () => {
        const machine='закрытый-бакет';
        const store=historyPg(pool);
        await store.configure(machine,[{topic:'закрытый/бакет',channel:'power'}],30000);
        const now=Number((await pool.query(`SELECT floor(extract(epoch FROM clock_timestamp())*1000) AS ms`)).rows[0].ms);
        const closed=Math.floor(now/30000)*30000-30000+800;
        await store.accept(machine,[{eventId:`закрытый-${closed}`,channel:'power',time:closed,value:8.5}]);
        const offered=(await store.work(machine)).items.some((item)=>{return item.until===closed;});
        assert.equal(offered,true,'closed furnace bucket was withheld');
    });

    it('does not fold the still-open furnace bucket into a closed page', async () => {
        const machine='граница-страницы';
        const store=historyPg(pool);
        await store.configure(machine,[{topic:'граница/страницы',channel:'power'}],30000);
        const now=Number((await pool.query(`SELECT floor(extract(epoch FROM clock_timestamp())*1000) AS ms`)).rows[0].ms);
        const open=Math.floor(now/30000)*30000+1200;
        const closed=open-30000;
        await store.accept(machine,[
            {eventId:`граница-закрытый-${closed}`,channel:'power',time:closed,value:1.25},
            {eventId:`граница-открытый-${open}`,channel:'power',time:open,value:9.25}
        ]);
        const work=(await store.work(machine)).items.find((item)=>{return item.until===closed;});
        const snapshot=await store.context(machine,work.from,work.until,60000);
        assert.equal(snapshot.items.some((point)=>{return point.time===open;}),false,'closed page included the open bucket');
    });

    it('removes an identical interior start covered by the committed segment', async () => {
        const machine='слияние-внутри';
        const store=historyPg(pool);
        await store.configure(machine,[{topic:'слияние/внутри',channel:'power'}],30000);
        const now=Number((await pool.query(`SELECT floor(extract(epoch FROM clock_timestamp())*1000) AS ms`)).rows[0].ms);
        const closed=Math.floor(now/30000)*30000-60000;
        const start=new Date(closed-10000);
        const mid=new Date(closed-9000);
        const end=new Date(closed-4000);
        await pool.query(`INSERT INTO segments(machine,kind,name,start_time,end_time,duration,tags,properties,options) VALUES
            ($1,'phase','on',$2,$3,1,'[]','{}','[]'),($1,'phase','on',$3,$4,5,'[]','{}','[]')`,[machine,start,mid,end]);
        await store.accept(machine,[{eventId:`слияние-${closed}`,channel:'power',time:closed,value:2.2}]);
        const work=(await store.work(machine)).items.find((item)=>{return item.until===closed;});
        const snapshot=await store.context(machine,work.from,work.until,0);
        await store.commit(machine,work.id,[{kind:'phase',name:'on',start_time:start,end_time:end,duration:6,tags:'[]',properties:'{}',options:'[]',resolved:true,consumed:true}],{...snapshot.context,revision:snapshot.revision,workToken:work.token});
        const left=await pool.query(`SELECT count(*) AS n FROM segments WHERE machine=$1 AND kind='phase'`,[machine]);
        assert.equal(Number(left.rows[0].n),1,'identical interior start survived the commit');
    });

    it('keeps a differently tagged start inside a committed span', async () => {
        const machine='чужая-метка';
        const store=historyPg(pool);
        await store.configure(machine,[{topic:'чужая/метка',channel:'power'}],30000);
        const now=Number((await pool.query(`SELECT floor(extract(epoch FROM clock_timestamp())*1000) AS ms`)).rows[0].ms);
        const closed=Math.floor(now/30000)*30000-90000;
        const start=new Date(closed-10000);
        const mid=new Date(closed-9000);
        const end=new Date(closed-4000);
        await pool.query(`INSERT INTO segments(machine,kind,name,start_time,end_time,duration,tags,properties,options) VALUES
            ($1,'phase','off',$2,$3,1,'[]','{}','[]'),($1,'phase','off',$3,$4,5,'["disconnector_switch"]','{}','[]')`,[machine,start,mid,end]);
        await store.accept(machine,[{eventId:`чужая-${closed}`,channel:'power',time:closed,value:6.6}]);
        const work=(await store.work(machine)).items.find((item)=>{return item.until===closed;});
        const snapshot=await store.context(machine,work.from,work.until,0);
        await store.commit(machine,work.id,[{kind:'phase',name:'off',start_time:start,end_time:end,duration:6,tags:'[]',properties:'{}',options:'[]',resolved:true,consumed:true}],{...snapshot.context,revision:snapshot.revision,workToken:work.token});
        const kept=await pool.query(`SELECT count(*) AS n FROM segments WHERE machine=$1 AND tags='["disconnector_switch"]'`,[machine]);
        assert.equal(Number(kept.rows[0].n),1,'operator cause was deleted with the identical cuts');
    });

});
