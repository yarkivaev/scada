import assert from 'node:assert/strict';
import pg from 'pg';
import { GenericContainer } from 'testcontainers';
import { readFile } from 'node:fs/promises';
import metricsStatePg, { metricsSinkFromPool } from '../../src/infrastructure/persistence/pg/metrics.js';
import historyPg from '../../src/infrastructure/persistence/pg/history.js';

describe('Historical telemetry PostgreSQL', function historyTests() {
    this.timeout(120000);
    let container;
    let pool;
    before(async () => {
        container = await new GenericContainer('postgres:16-alpine').withEnvironment({ POSTGRES_PASSWORD: 'test' }).withExposedPorts(5432).start();
        pool = new pg.Pool({ host: container.getHost(), port: container.getMappedPort(5432), user: 'postgres', password: 'test' });
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
    });
    after(async () => { await pool?.end(); await container?.stop(); });
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
        const time = Date.now() - 10000;
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
        const time = Date.now() - 2000;
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
        const time=Date.now()-5000;
        await pool.query('INSERT INTO metrics(topic,ts,value) VALUES($1,$2,$3)', ['MX210/icht-1/GET/AI3/VALUE',new Date(time),5]);
        assert.equal((await store.work('offline')).items.length,1);
        assert.equal((await store.context('offline',time,time)).items[0].value,5);
    });

    it('rejects stale work claims after the bucket was expanded or recreated', async () => {
        const store = historyPg(pool);
        await store.configure('claim', [{topic:'claim/power',channel:'power'}],30000);
        const time=Math.floor(Date.now()/30000)*30000;
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
        await pool.query('CREATE ROLE supervisor_sink');
        await pool.query('GRANT SELECT, INSERT ON metrics TO supervisor_sink');
        await pool.query(await readFile(new URL('../../db/migrations/E0005__historical_telemetry_grants.sql', import.meta.url),'utf8'));
        await pool.query(await readFile(new URL('../../db/migrations/E0008__metric_receipts_grants.sql', import.meta.url),'utf8'));
        const client=await pool.connect();
        try {
            await client.query('SET ROLE supervisor_sink');
            assert.equal((await client.query('SELECT count(*) FROM history_work')).rowCount,1);
            await metricsSinkFromPool(client,{firstWins:true}).write([{topic:'role/metric',ts:Date.now(),value:1}]);
            await client.query("INSERT INTO history_topics(machine,topic,channel) VALUES('role','role/topic','value')");
        } finally { await client.query('RESET ROLE'); client.release(); }
    });

    it('refreshes pending segment write time for the existing silence watchdog', async () => {
        const store=historyPg(pool); const time=Date.now()-10000;
        await pool.query("INSERT INTO segments(machine,kind,name,start_time,end_time,duration,updated_at) VALUES('fresh','phase','off',$1,$2,0,now()-interval '1 hour')",[new Date(time),new Date(time+1000)]);
        await store.accept('fresh',[{eventId:'fresh',channel:'a',time,value:0}]);
        const work=(await store.work('fresh')).items[0]; const context=await store.context('fresh',time,time);
        await store.commit('fresh',work.id,context.segments,{...context.context,revision:context.revision,workToken:work.token});
        assert.ok(Date.now()-new Date((await pool.query("SELECT updated_at FROM segments WHERE machine='fresh'")).rows[0].updated_at).getTime()<5000);
    });

    it('imports already persisted telemetry on first topic registration without duplicate work on restart', async () => {
        const store=historyPg(pool); const time=Date.now()-1000;
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
        assert.equal(work.length,8); assert.equal(work[0].until,now);
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
            await store.commit(machine,work.id,rows,{...context.context,revision:context.revision,workToken:work.token});
            // Restart loses all application memory between every page.
            store=historyPg(pool);
            pages+=1;
            assert.ok(pages<60);
        }
        /* eslint-enable no-await-in-loop */
        const original=(await pool.query('SELECT end_time,tags FROM history_annotations WHERE machine=$1 AND start_time=$2',[machine,new Date(time)])).rows[0];
        assert.equal(original.end_time.getTime(),time+12030000);
        assert.equal(seen.size,12001);
        assert.equal(Number((await pool.query('SELECT count(*) FROM segments WHERE machine=$1',[machine])).rows[0].count),12001);
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

});
