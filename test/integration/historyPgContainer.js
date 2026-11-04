import assert from 'node:assert/strict';
import pg from 'pg';
import { GenericContainer } from 'testcontainers';
import { readFile } from 'node:fs/promises';
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
        await pool.query(await readFile(new URL('../../db/migrations/E0001__edge_metrics.sql', import.meta.url), 'utf8'));
        await pool.query(await readFile(new URL('../../db/migrations/V0010__historical_telemetry.sql', import.meta.url), 'utf8'));
    });
    after(async () => { await pool?.end(); await container?.stop(); });
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

});
