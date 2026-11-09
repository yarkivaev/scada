import assert from 'node:assert/strict';
import {GenericContainer} from 'testcontainers';
import {createClient} from '@clickhouse/client';
import {nativeMetricIslandPoints} from '../../src/infrastructure/persistence/clickhouse/nativeMetricsCompaction.js';
import canonicalMetrics from '../../src/infrastructure/persistence/clickhouse/canonicalMetrics.js';

describe('native point storage physical compaction',function(){
    this.timeout(180000);
    let client; let container; let sink; let url;let clock=20000;
    const domain='d'.repeat(64);
    const p=(topic,ts,value=42,compactWindowMs=1000)=>{return {topic,ts,value,compactWindowMs,historyWindowMs:10000,maxHistoryAgeMs:100000,futureSkewMs:1000}};
    const context=()=>{return {admittedAt:clock,batchId:'a'.repeat(64)}};
    const rows=async(query)=>{return await(await client.query({query,format:'JSONEachRow'})).json()};
    before(async()=>{container=await new GenericContainer('clickhouse/clickhouse-server:24').withExposedPorts(8123).start();url=`http://${container.getHost()}:${container.getMappedPort(8123)}`;client=createClient({url});sink=canonicalMetrics(url,domain,{now:()=>{return clock},cleanupIntervalMs:0,compactionGraceMs:120000});await sink.start();});
    after(async()=>{await sink?.stop();await client?.close();await container?.stop();});
    it('uses ordinary native rows and physically deletes only sealed constant interiors',async()=>{
        await sink.write([p('constant',10000),p('constant',10100),p('constant',10200),p('mixed',10000),p('mixed',10100,43),p('mixed',10200)],context());
        await sink.write([p('constant',30000),p('mixed',30000)],{...context(),admittedAt:30000});
        assert.equal(Number((await rows("SELECT count() n FROM scada.metrics_points_v4 WHERE topic='constant'"))[0].n),4);
        await sink.runCompaction();
        assert.equal(Number((await rows("SELECT count() n FROM scada.metrics_points_v4 WHERE topic='constant'"))[0].n),4,'grace protects in-flight bounded reads');
        clock=200000;await sink.runCompaction();
        assert.equal(Number((await rows("SELECT count() n FROM scada.metrics_points_v4 FINAL WHERE topic='constant'"))[0].n),4,'endpoint certificate grace preserves raw interiors for in-flight reads');
        clock=400000;await sink.runCompaction();
        await client.command({query:'OPTIMIZE TABLE scada.metrics_points_v4 FINAL'});
        assert.equal(Number((await rows("SELECT count() n FROM scada.metrics_points_v4 WHERE topic='constant'"))[0].n),3);
        assert.equal(Number((await rows("SELECT count() n FROM scada.metrics_points_v4 WHERE topic='mixed'"))[0].n),4);
        const engine=(await rows("SELECT engine FROM system.tables WHERE database='scada' AND name='metrics_points_v4'"))[0].engine;assert.equal(engine,'ReplacingMergeTree');
    });
    it('preserves a gap between constant runs in the merged sensor stream',async()=>{
        clock=20000;
        const point=ts=>{return {...p('gap-regression',ts),maxGapMs:300};};
        await sink.write([point(10000),point(10200),point(10900)],context());
        await sink.write([point(10100),point(10800),point(10950)],context());
        clock=40000;await sink.write([point(40000)],context());
        clock=200000;await sink.runCompaction();clock=400000;await sink.runCompaction();
        await client.command({query:'OPTIMIZE TABLE scada.metrics_points_v4 FINAL'});
        const actual=await rows("SELECT toUnixTimestamp64Milli(ts) AS t FROM scada.metrics_points_v4 FINAL WHERE topic='gap-regression' AND ts<fromUnixTimestamp64Milli(11000) ORDER BY ts");
        assert.deepEqual(actual.map(row=>{return Number(row.t)}),[10000,10200,10800,10950], 'keep both sides of the observation gap');
    });
    it('merges interleaved collectors and keeps strict-threshold gaps and singleton islands',async()=>{
        clock=20000;
        const point=(topic,ts,maxGapMs=100)=>{return {...p(topic,ts),maxGapMs};};
        await sink.write([10000,10200,10400,10600,10800].map(ts=>{return point('interleaved-gap',ts);}),context());
        await sink.write([10100,10300,10500,10700,10900].map(ts=>{return point('interleaved-gap',ts);}),context());
        await sink.write([10000,10100,10200,10301,10401,10501,10900].map(ts=>{return point('strict-gap',ts);}),context());
        await sink.write([10000,10400,10800].map(ts=>{return point('singleton-gap',ts);}),context());
        clock=40000;await sink.write(['interleaved-gap','strict-gap','singleton-gap'].map(topic=>{return point(topic,40000);}),context());
        clock=200000;await sink.runCompaction();clock=400000;await sink.runCompaction();
        await client.command({query:'OPTIMIZE TABLE scada.metrics_points_v4 FINAL'});
        const times=async(topic)=>{return (await rows(`SELECT toUnixTimestamp64Milli(ts) AS t FROM scada.metrics_points_v4 FINAL WHERE topic='${topic}' AND ts<fromUnixTimestamp64Milli(11000) ORDER BY ts`)).map(row=>{return Number(row.t);});};
        assert.deepEqual(await times('interleaved-gap'),[10000,10900],'equal threshold is continuous after collectors merge');
        assert.deepEqual(await times('strict-gap'),[10000,10200,10301,10501,10900],'strictly larger interval separates islands');
        assert.deepEqual(await times('singleton-gap'),[10000,10400,10800],'isolated observations remain exactly once');
    });
    it('keeps long certified coverage stable after physical deletion and restart',async()=>{
        clock=20000;
        const point=ts=>{return {...p('long-certified-gap',ts),maxGapMs:100};};
        await sink.write(Array.from({length:10},(unused,index)=>{return point(10000+index*100);}),context());
        clock=40000;await sink.write([point(40000)],context());
        clock=200000;await sink.runCompaction();clock=400000;await sink.runCompaction();
        await client.command({query:'OPTIMIZE TABLE scada.metrics_points_v4 FINAL'});
        const islands=async()=>{return await rows(`SELECT DISTINCT island_first_ms,island_last_ms,island_n FROM (${nativeMetricIslandPoints()}) WHERE topic='long-certified-gap' AND point_ms<11000`);};
        assert.deepEqual((await islands()).map(row=>{return [Number(row.island_first_ms),Number(row.island_last_ms),Number(row.island_n)];}),[[10000,10900,2]]);
        const restarted=canonicalMetrics(url,domain,{now:()=>{return clock},cleanupIntervalMs:0,compactionGraceMs:120000});
        try{await restarted.start();await restarted.runCompaction();await restarted.runCompaction();}finally{await restarted.stop();}
        assert.deepEqual((await islands()).map(row=>{return [Number(row.island_first_ms),Number(row.island_last_ms),Number(row.island_n)];}),[[10000,10900,2]],'certificate is one covered interval even when its endpoints exceed maxGap');
        assert.equal(Number((await rows("SELECT count() n FROM scada.metrics_points_v4 FINAL WHERE topic='long-certified-gap'"))[0].n),3);
    });
    it('retains windows containing different frozen gap policies',async()=>{
        clock=20000;
        const point=(ts,maxGapMs)=>{return {...p('changed-gap-policy',ts),maxGapMs};};
        await sink.write([point(10000,100),point(10100,100),point(10200,100),point(10300,200),point(10400,200),point(10500,200)],context());
        clock=40000;await sink.write([point(40000,1000)],context());
        clock=200000;await sink.runCompaction();clock=400000;await sink.runCompaction();
        await client.command({query:'OPTIMIZE TABLE scada.metrics_points_v4 FINAL'});
        assert.equal(Number((await rows("SELECT count() n FROM scada.metrics_points_v4 FINAL WHERE topic='changed-gap-policy' AND ts<fromUnixTimestamp64Milli(11000)"))[0].n),6);
    });
    it('preserves neighboring Float64 values and constant endpoint bits after physical compaction',async()=>{
        clock=20000;
        await sink.write([p('binary-constant',10000,1.586),p('binary-constant',10100,1.586),p('binary-constant',10200,1.586),
            p('binary-adjacent',10000,1.586),p('binary-adjacent',10100,1.5860000000000003),p('binary-adjacent',10200,1.586)],context());
        const bits=async(topic)=>{return (await rows(`SELECT toString(reinterpretAsUInt64(value)) AS bits FROM scada.metrics_points_v4 FINAL WHERE topic='${topic}' AND ts<fromUnixTimestamp64Milli(11000) ORDER BY ts`)).map(row=>{return row.bits;});};
        assert.deepEqual(await bits('binary-constant'),['4609821528181656519','4609821528181656519','4609821528181656519']);
        assert.deepEqual(await bits('binary-adjacent'),['4609821528181656519','4609821528181656520','4609821528181656519']);
        clock=40000;await sink.write([p('binary-constant',40000,1.586),p('binary-adjacent',40000,1.586)],context());
        clock=200000;await sink.runCompaction();clock=400000;await sink.runCompaction();
        await client.command({query:'OPTIMIZE TABLE scada.metrics_points_v4 FINAL'});
        assert.deepEqual(await bits('binary-constant'),['4609821528181656519','4609821528181656519']);
        assert.deepEqual(await bits('binary-adjacent'),['4609821528181656519','4609821528181656520','4609821528181656519']);
    });
    it('keeps last admitted timestamp conflicts and rejects attempts to rewrite sealed history',async()=>{
        clock=20000;await sink.write([p('winner',19000,1),p('winner',19000,2)],context());await sink.write([p('winner',19000,3)],context());
        assert.equal((await rows("SELECT value FROM scada.metrics_points_v4 FINAL WHERE topic='winner'"))[0].value,3);
        clock=40000;await sink.write([p('winner',40000,4)],context());await sink.write([p('winner',19000,99)],context());
        assert.equal((await rows("SELECT value FROM scada.metrics_points_v4 FINAL WHERE topic='winner' AND ts=fromUnixTimestamp64Milli(19000)"))[0].value,3);
        assert.equal((await rows("SELECT reason FROM scada.metrics_rejected_v4 WHERE topic='winner'"))[0].reason,'too_old');
    });
    it('retains overlapping policies and legacy windows while compacting future separate windows',async()=>{
        clock=20000;
        await sink.write([p('policy',10000),p('policy',10100),p('policy',10200),p('policy',10300,42,500),p('policy',12000,42,500),p('policy',12100,42,500),p('policy',12200,42,500)],context());
        await client.insert({table:'scada.metrics',values:[{topic:'legacy-policy',ts:'1970-01-01 00:00:10.050',value:42}],format:'JSONEachRow'});
        await sink.write([p('legacy-policy',10000),p('legacy-policy',10100),p('legacy-policy',10200)],context());
        clock=40000;await sink.write([p('policy',40000),p('legacy-policy',40000)],context());
        clock=200000;await sink.runCompaction();clock=400000;await sink.runCompaction();await client.command({query:'OPTIMIZE TABLE scada.metrics_points_v4 FINAL'});
        assert.equal(Number((await rows("SELECT count() n FROM scada.metrics_points_v4 WHERE topic='policy' AND ts<fromUnixTimestamp64Milli(11000)"))[0].n),4);
        assert.equal(Number((await rows("SELECT count() n FROM scada.metrics_points_v4 WHERE topic='policy' AND ts>=fromUnixTimestamp64Milli(12000) AND ts<fromUnixTimestamp64Milli(13000)"))[0].n),2);
        assert.equal(Number((await rows("SELECT count() n FROM scada.metrics_points_v4 WHERE topic='legacy-policy'"))[0].n),4);
    });
    it('ignores lower revisions arriving after a higher winner and keeps a restarted frontier monotonic',async()=>{
        clock=20000;await sink.write([p('restart',19000,1)],context());await sink.write([p('restart',19000,2)],context());
        await client.insert({table:'scada.metrics_points_v4',values:[{topic:'restart',ts:'1970-01-01 00:00:19.000',value:99,compact_ms:1000,revision:'1'}],format:'JSONEachRow'});
        assert.equal((await rows("SELECT value FROM scada.metrics_points_v4 FINAL WHERE topic='restart'"))[0].value,2);
        clock=40000;await sink.write([p('restart',40000,4)],context());
        const restarted=canonicalMetrics(url,domain,{now:()=>{return clock},cleanupIntervalMs:0});
        try{await restarted.write([{...p('restart',19000,99),historyWindowMs:1000000}],context());}finally{await restarted.stop();}
        assert.equal(Number((await rows("SELECT closed_before FROM scada.metrics_state_v4 FINAL WHERE key='topic:restart'"))[0].closed_before),30000);
        assert.equal((await rows("SELECT value FROM scada.metrics_points_v4 FINAL WHERE topic='restart' AND ts=fromUnixTimestamp64Milli(19000)"))[0].value,2);
    });
    it('pins an incompatible admission domain before writing',async()=>{
        const foreign=canonicalMetrics(url,'f'.repeat(64),{cleanupIntervalMs:0});
        try{await assert.rejects(foreign.start(),/admission domain/u);}finally{await foreign.stop();}
    });

    it('never resurrects a superseded differing revision after deleting a constant interior',async()=>{
        clock=20000;await sink.write([p('stale-conflict',10000),p('stale-conflict',10100),p('stale-conflict',10200)],context());
        await client.insert({table:'scada.metrics_points_v4',values:[{topic:'stale-conflict',ts:'1970-01-01 00:00:10.100',value:99,compact_ms:1000,revision:'1'}],format:'JSONEachRow'});
        clock=40000;await sink.write([p('stale-conflict',40000)],context());
        clock=200000;await sink.runCompaction();
        assert.deepEqual((await rows("SELECT value FROM scada.metrics_read WHERE topic='stale-conflict' ORDER BY ts")).map(({value})=>{return value;}),[42,42,42]);
        await client.insert({table:'scada.metrics_points_v4',values:[{topic:'stale-conflict',ts:'1970-01-01 00:00:10.100',value:99,compact_ms:1000,revision:'1'}],format:'JSONEachRow'});
        assert.deepEqual((await rows("SELECT value FROM scada.metrics_read WHERE topic='stale-conflict' ORDER BY ts")).map(({value})=>{return value;}),[42,42,42]);
        clock=400000;await sink.runCompaction();await client.command({query:'OPTIMIZE TABLE scada.metrics_points_v4 FINAL'});
        assert.equal(Number((await rows("SELECT count() n FROM scada.metrics_points_v4 WHERE topic='stale-conflict'"))[0].n),3);
        await client.insert({table:'scada.metrics_points_v4',values:[{topic:'stale-conflict',ts:'1970-01-01 00:00:10.100',value:99,compact_ms:500,revision:'1'}],format:'JSONEachRow'});
        assert.deepEqual((await rows("SELECT value FROM scada.metrics_read WHERE topic='stale-conflict' ORDER BY ts")).map(({value})=>{return value;}),[42,42,42]);
        await sink.runCompaction();await client.command({query:'OPTIMIZE TABLE scada.metrics_points_v4 FINAL'});
        assert.equal(Number((await rows("SELECT count() n FROM scada.metrics_points_v4 WHERE topic='stale-conflict'"))[0].n),3);
    });

    it('requires both endpoint rows before suppressing any retained raw interior',async()=>{
        clock=20000;await sink.write([p('partial-certificate',10000),p('partial-certificate',10100),p('partial-certificate',10200)],context());
        clock=40000;await sink.write([p('partial-certificate',40000)],context());
        const state=(await rows("SELECT committed_seq FROM scada.metrics_state_v4 FINAL WHERE key='topic:partial-certificate'"))[0];
        await client.insert({table:'scada.metrics_points_v4',values:[{topic:'partial-certificate',ts:'1970-01-01 00:00:10.000',value:42,compact_ms:1000,revision:(BigInt(state.committed_seq)*1024n+1000n).toString(),max_gap_ms:30000,is_compacted:1,compact_first:10000,compact_last:10200,compacted_at:40000}],format:'JSONEachRow'});
        assert.equal(Number((await rows("SELECT count() n FROM scada.metrics_raw_read WHERE topic='partial-certificate'"))[0].n),4);
        clock=200000;await sink.runCompaction();
        assert.equal(Number((await rows("SELECT count() n FROM scada.metrics_points_v4 FINAL WHERE topic='partial-certificate'"))[0].n),4);
        assert.equal(Number((await rows("SELECT count() n FROM scada.metrics_raw_read WHERE topic='partial-certificate'"))[0].n),3);
        clock=400000;await sink.runCompaction();await client.command({query:'OPTIMIZE TABLE scada.metrics_points_v4 FINAL'});
        assert.equal(Number((await rows("SELECT count() n FROM scada.metrics_points_v4 WHERE topic='partial-certificate'"))[0].n),3);
    });

    it('requires a shared positive gap policy in a complete certificate pair',async()=>{
        const proof=(topic,maxGapMs,lastGapMs)=>{return [
            {topic,ts:'1970-01-01 00:00:10.000',value:42,compact_ms:1000,max_gap_ms:maxGapMs,revision:'1000',is_compacted:1,compact_first:10000,compact_last:10200,compacted_at:40000},
            {topic,ts:'1970-01-01 00:00:10.100',value:42,compact_ms:1000,max_gap_ms:maxGapMs,revision:'1'},
            {topic,ts:'1970-01-01 00:00:10.200',value:42,compact_ms:1000,max_gap_ms:lastGapMs,revision:'1000',is_compacted:1,compact_first:10000,compact_last:10200,compacted_at:40000}
        ];};
        await client.insert({table:'scada.metrics_points_v4',values:[...proof('mismatched-gap-proof',100,200),...proof('zero-gap-proof',0,0)],format:'JSONEachRow'});
        const actual=await rows("SELECT topic,count() n FROM scada.metrics_raw_read WHERE topic IN ('mismatched-gap-proof','zero-gap-proof') GROUP BY topic ORDER BY topic");
        assert.deepEqual(actual.map(row=>{return [row.topic,Number(row.n)];}),[['mismatched-gap-proof',3],['zero-gap-proof',3]],'invalid proof cannot suppress raw interior');
    });

    it('seeds a new topic frontier from recent legacy history without trusting a future legacy clock',async()=>{
        clock=2000000;
        await client.insert({table:'scada.metrics',values:[
            {topic:'legacy-seed',ts:new Date(1990000).toISOString().replace('T',' ').slice(0,-1),value:41},
            {topic:'legacy-future',ts:new Date(10000000).toISOString().replace('T',' ').slice(0,-1),value:99}
        ],format:'JSONEachRow'});
        await sink.write([p('legacy-seed',1950000,42),p('legacy-future',1999000,44)],context());
        assert.equal(Number((await rows("SELECT count() n FROM scada.metrics_points_v4 FINAL WHERE topic='legacy-seed'"))[0].n),0);
        assert.equal((await rows("SELECT value FROM scada.metrics_points_v4 FINAL WHERE topic='legacy-future'"))[0].value,44);
        assert.equal(Number((await rows("SELECT latest FROM scada.metrics_state_v4 FINAL WHERE key='topic:legacy-future'"))[0].latest),1999000);
        assert.equal((await rows("SELECT reason FROM scada.metrics_rejected_v4 WHERE topic='legacy-seed'"))[0].reason,'too_old');
    });

});
