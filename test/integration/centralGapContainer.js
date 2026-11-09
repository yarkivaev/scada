import assert from 'node:assert/strict';
import { GenericContainer } from 'testcontainers';
import { createClient } from '@clickhouse/client';
import nativeMetricsSchema from '../../src/infrastructure/persistence/clickhouse/nativeMetricsSchema.js';
import metricsRelation, { rawMetricsRange, rawMetricsRelation } from '../../src/infrastructure/persistence/clickhouse/metricsRelation.js';
import metricsQuery from '../../src/infrastructure/persistence/clickhouse/metricsQuery.js';
import clickhouseSeries from '../../src/infrastructure/persistence/clickhouse/series.js';
import clickhouseHolds from '../../src/infrastructure/persistence/clickhouse/holds.js';

const BASE=Date.parse('2026-01-01T00:00:00Z');
function timestamp(offset) {return new Date(BASE+offset).toISOString().replace('T',' ').replace('Z','');}
function range(start,end) {return {start:new Date(BASE+start),end:new Date(BASE+end)};}

describe('Gap-preserving native charts on ClickHouse 24', function() {
    this.timeout(120000);
    let container;
    let client;
    let connection;
    before(async function() {
        container=await new GenericContainer('clickhouse/clickhouse-server:24').withExposedPorts(8123).start();
        client=createClient({url:`http://${container.getHost()}:${container.getMappedPort(8123)}`});
        connection={query(sql,params){return metricsQuery(client,sql,params);}};
        await nativeMetricsSchema(client,'a'.repeat(64),metricsRelation,rawMetricsRelation);
    });
    after(async function() {await client?.close();await container?.stop();});
    async function seed(topic,offsets,{certificate=false,closed=true,value=7,maxGap=1000}={}) {
        const values=offsets.map(offset=>{return {topic,ts:timestamp(offset),value:typeof value==='function'?value(offset):value,
            compact_ms:60000,max_gap_ms:maxGap,revision:'1',is_compacted:certificate?1:0,
            compact_first:certificate?BASE+offsets[0]:0,compact_last:certificate?BASE+offsets.at(-1):0,compacted_at:certificate?1:0};});
        await client.insert({table:'scada.metrics_points_v4',values,format:'JSONEachRow'});
        if(closed) {await client.insert({table:'scada.metrics_state_v4',values:[{key:`topic:${topic}`,latest:BASE+60000,closed_before:BASE+60000,published_at:1,committed_seq:1,revision:'1'}],format:'JSONEachRow'});}
    }
    it('clips long allowed gaps using bounded nearest-neighbor window contexts', async function() {
        const hour=3600000;
        await seed('long-gap',[0,3*hour],{maxGap:4*hour});
        const graph=await clickhouseSeries(connection,'long-gap',range(1.5*hour-50,1.5*hour+50),60000,'');
        assert.deepEqual(graph.map(point=>{return point.timestamp.getTime()-BASE;}),[1.5*hour-50,1.5*hour+50]);
        assert.deepEqual(graph.map(point=>{return point.continuous;}),[false,true]);
        const held=await clickhouseHolds(connection,'long-gap',range(1.5*hour-50,1.5*hour+50),4*hour,'');
        assert.equal(held.length,1);
        assert.equal(held[0].timestamp.getTime()-BASE,1.5*hour-50);
        assert.equal(held[0].until.getTime()-BASE,1.5*hour+50);
        await seed('too-long-gap',[0,5*hour],{maxGap:4*hour});
        assert.deepEqual(await clickhouseSeries(connection,'too-long-gap',range(2.5*hour-50,2.5*hour+50),60000,''),[]);
        await seed('neighbor-cert',[0,10000],{maxGap:4*hour,certificate:true});
        await seed('neighbor-cert',[3*hour],{maxGap:4*hour});
        const certified=await clickhouseSeries(connection,'neighbor-cert',range(1.5*hour-50,1.5*hour+50),60000,'');
        assert.deepEqual(certified.map(point=>{return point.continuous;}),[false,true]);
        assert.deepEqual(await clickhouseSeries(connection,'long-gap',range(3*hour+1,3*hour+1000),60000,''),[]);
    });
    it('clips constant continuity across adjacent window boundaries without bridging real gaps', async function() {
        await seed('boundary',[59800,59900,60100,60200]);
        await client.command({query:`ALTER TABLE scada.metrics_state_v4 UPDATE closed_before=${BASE+120000} WHERE key='topic:boundary'`,clickhouse_settings:{mutations_sync:1}});
        const graph=await clickhouseSeries(connection,'boundary',range(59950,60050),60000,'');
        assert.deepEqual(graph.map(point=>{return point.timestamp.getTime()-BASE;}),[59950,60050]);
        assert.equal(graph[1].continuous,true);
        await seed('boundary-gap',[58000,59000,61000,62000]);
        assert.deepEqual(await clickhouseSeries(connection,'boundary-gap',range(59950,60050),60000,''),[]);
    });
    it('keeps exact density and strict holds available for unthinned two-point raw islands', async function() {
        await seed('two-raw',[0,500]);
        const counted=await connection.query(`SELECT count() AS n FROM ${rawMetricsRange(`${BASE}`,`${BASE+1000}`)} WHERE topic='two-raw'`,{topic:'two-raw'});
        assert.equal(Number(counted[0].n),2);
        const holds=await clickhouseHolds(connection,'two-raw',range(0,1000),100,'');
        assert.deepEqual(holds.map(row=>{return [row.timestamp.getTime()-BASE,row.until.getTime()-BASE];}),[[0,0],[500,500]]);
    });
    it('keeps both runs separate even inside one coarse bucket, before physical deletion', async function() {
        await seed('runs',[0,500,1000,10000,10500,11000]);
        const graph=await clickhouseSeries(connection,'runs',range(0,20000),60000,'mm');
        assert.deepEqual(graph.map(point=>{return point.value;}),[7,7,null,7,7]);
        assert.deepEqual(graph.filter(point=>{return point.value!==null;}).map(point=>{return point.timestamp.getTime()-BASE;}),[0,1000,10000,11000]);
        assert.deepEqual(graph.filter(point=>{return point.value!==null;}).map(point=>{return point.continuous;}),[false,true,false,true]);
        assert.deepEqual(await clickhouseSeries(connection,'runs',range(2000,9000),60000,'mm'),[]);
        const clipped=await clickhouseSeries(connection,'runs',range(200,800),60000,'mm');
        assert.deepEqual(clipped.map(point=>{return point.timestamp.getTime()-BASE;}),[200,800]);
    });
    it('keeps long complete certificates continuous after raw interiors have disappeared', async function() {
        await seed('long',[0,10000],{certificate:true});
        const graph=await clickhouseSeries(connection,'long',range(1000,9000),1000,'');
        assert.deepEqual(graph.map(point=>{return point.timestamp.getTime()-BASE;}),[1000,9000]);
        assert.deepEqual(graph.map(point=>{return point.continuous;}),[false,true]);
        const holds=await clickhouseHolds(connection,'long',range(1000,9001),1000,'');
        assert.equal(holds.length,1);
        assert.equal(holds[0].timestamp.getTime(),BASE+1000);
        assert.equal(holds[0].until.getTime(),BASE+9001);
        await assert.rejects(clickhouseHolds(connection,'long',range(1000,9000),999,''),{code:'SCADA_HISTORY_DENSITY_UNAVAILABLE'});
    });
    it('does not turn a partial certificate into clipped constant coverage', async function() {
        await seed('partial',[0,10000],{closed:false});
        await client.command({query:`ALTER TABLE scada.metrics_points_v4 UPDATE is_compacted=1,compact_first=${BASE},compact_last=${BASE+10000} WHERE topic='partial' AND ts=fromUnixTimestamp64Milli(${BASE})`,clickhouse_settings:{mutations_sync:1}});
        assert.deepEqual(await clickhouseSeries(connection,'partial',range(1000,9000),1000,''),[]);
    });
    it('retains strict equality continuity, singletons, and mixed spikes', async function() {
        await seed('equal',[0,1000,2000]);
        assert.equal((await clickhouseSeries(connection,'equal',range(0,3000),60000,'')).filter(point=>{return point.value===null;}).length,0);
        await seed('single',[500]);
        assert.deepEqual(await clickhouseSeries(connection,'single',range(600,900),1000,''),[]);
        await seed('spike',[0,500,1000],{value:offset=>{return offset===500?99:7;}});
        const graph=await clickhouseSeries(connection,'spike',range(0,2000),1000,'');
        assert(graph.some(point=>{return point.value===99;}));
    });
    it('retains both values across adjacent millisecond frozen-policy changes', async function() {
        await seed('adjacent-policy',[0],{maxGap:1000,value:7});
        await seed('adjacent-policy',[1],{maxGap:2000,value:9});
        const graph=await clickhouseSeries(connection,'adjacent-policy',range(0,1),60000,'');
        assert.deepEqual(graph.map(point=>{return point.value;}),[7,9]);
        assert.equal(graph[1].continuous,false);
    });
    it('rejects installed old native canonical views rather than silently querying them', async function() {
        await client.command({query:'DROP VIEW scada.metrics_read'});
        await client.command({query:'DROP VIEW scada.metrics_raw_read'});
        await client.command({query:'DROP TABLE scada.metrics_points_v4'});
        await client.command({query:'CREATE TABLE scada.metrics_points_v3(topic String,ts DateTime64(3),value Float64) ENGINE=MergeTree ORDER BY(topic,ts)'});
        await client.command({query:'CREATE VIEW scada.metrics_read AS SELECT * FROM scada.metrics_points_v3'});
        await client.command({query:'CREATE VIEW scada.metrics_raw_read AS SELECT * FROM scada.metrics_points_v3'});
        await assert.rejects(connection.query('SELECT * FROM scada.metrics_read'),/explicit v4 migration/u);
        await assert.rejects(connection.query('SELECT * FROM scada.metrics_raw_read'),/explicit v4 migration/u);
    });

});
