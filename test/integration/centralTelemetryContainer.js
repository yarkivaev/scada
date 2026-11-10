import assert from 'node:assert/strict';
import amqp from 'amqplib';
import pg from 'pg';
import siteServer from '../../src/application/siteServer.js';
import clickhouseSeries from '../../src/infrastructure/persistence/clickhouse/series.js';
import { GenericContainer, Wait } from 'testcontainers';
import { createClient } from '@clickhouse/client';
import canonicalMetrics from '../../src/infrastructure/persistence/clickhouse/canonicalMetrics.js';
import metricsRelation from '../../src/infrastructure/persistence/clickhouse/metricsRelation.js';
import clickhouseHolds from '../../src/infrastructure/persistence/clickhouse/holds.js';
import clickhouseConnection from '../../src/infrastructure/persistence/clickhouse/connection.js';
import centralMetricsSink from '../../src/infrastructure/ingest/telemetry/centralMetricsSink.js';
import centralTelemetryPreflight from '../../src/infrastructure/ingest/telemetry/centralTelemetryPreflight.js';
import centralPolicy from '../../src/infrastructure/ingest/telemetry/centralPolicy.js';
import { admissionDomain, targetIdentity, encodeBatch, decodeBatch, MAX_BATCH_BYTES } from '../../src/infrastructure/ingest/telemetry/centralEnvelope.js';
import amqpMetricsIngest from '../../src/infrastructure/ingest/telemetry/amqpMetricsIngest.js';
import siteSyncTargets from '../../src/application/sync/siteSyncTargets.js';
import amqpSource from '../../src/infrastructure/streams/amqpSource.js';
import centralQueueSession, {centralQueueOptions} from '../../src/infrastructure/ingest/telemetry/centralQueueSession.js';

import centralFaultProxy from '../helpers/centralFaultProxy.js';
/* eslint-disable no-await-in-loop */

async function eventually(action, expected, timeout = 10000) {
    const deadline = Date.now() + timeout;
    let actual;
    do {
        actual = await action();
        if (JSON.stringify(actual) === JSON.stringify(expected)) { return; }
        await new Promise((resolve) => { setTimeout(resolve, 25); });
    } while (Date.now() < deadline);
    assert.deepEqual(actual, expected);
}

describe('ClickHouse native admission and immutable compact history', function() {
    this.timeout(180000);
    let clickhouse;
    let rabbit;
    let client;
    let url;
    let broker;
    let connection;
    let channel;
    let domain;
    const BASE = Math.floor(Date.now()/60000)*60000-3600000;
    const rule = {compactWindowMs:1000,historyWindowMs:2000,maxHistoryAgeMs:2592000000,futureSkewMs:300000};
    const policy = { enabled: true, default:rule };
    function env(extra = {}) { return { CLICKHOUSE_URL: url, AMQP_URL: broker, CENTRAL_TELEMETRY_POLICY: JSON.stringify({ ...policy, ...extra }) }; }
    before(async function() {
        [clickhouse, rabbit] = await Promise.all([
            new GenericContainer('clickhouse/clickhouse-server:24').withExposedPorts(8123).start(),
            new GenericContainer('rabbitmq:3.13-management').withEnvironment({ RABBITMQ_DEFAULT_USER: 'test', RABBITMQ_DEFAULT_PASS: 'test', RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS: '+S 2:2 +A 2' })
                .withExposedPorts(5672,15672,15671,15691,15692,25672,4369,5671).withWaitStrategy(Wait.forHttp('/api/overview',15672).withBasicCredentials('test','test')).start()
        ]);
        url = `http://${clickhouse.getHost()}:${clickhouse.getMappedPort(8123)}`;
        broker = `amqp://test:test@${rabbit.getHost()}:${rabbit.getMappedPort(5672)}`;
        domain = admissionDomain(broker, centralPolicy(policy).queue, targetIdentity(url));
        client = createClient({ url });
        await client.command({ query: 'CREATE DATABASE scada' });
        await client.command({ query: 'CREATE TABLE scada.metrics(topic String,ts DateTime64(3),value Float64) ENGINE=MergeTree ORDER BY(topic,ts)' });
        connection = await amqp.connect(broker);
        channel = await connection.createChannel();
        await client.command({query:"CREATE USER reader IDENTIFIED BY 'test'"});
        await client.command({query:'GRANT SELECT ON scada.* TO reader'});
    });
    after(async function() {
        await Promise.allSettled([connection?.close(), client?.close()]);
        await Promise.allSettled([clickhouse?.stop(), rabbit?.stop()]);
    });
    async function rows(topic) {
        const response = await client.query({ query: `SELECT toUnixTimestamp64Milli(ts) AS ts,value FROM ${metricsRelation} WHERE topic={topic:String} ORDER BY ts`, query_params: { topic }, format: 'JSONEachRow' });
        return (await response.json()).map((row) => { return { ts: Number(row.ts)-BASE, value: row.value }; });
    }
    function point(topic, ts, value, compactWindowMs = 1000) { return { topic, ts:BASE+ts, value, ...rule, compactWindowMs, historyWindowMs:Math.max(2000,compactWindowMs*2) }; }
    it('keeps legacy-only read-only consumers working before additive schema installation', async function() {
        const reader = await clickhouseConnection(clickhouse.getHost(), { port: clickhouse.getMappedPort(8123), username: 'reader', password: 'test' });
        try { assert.deepEqual(await reader.query('SELECT * FROM scada.metrics_read'), []); }
        finally { await reader.close(); }
    });
    it('physically reduces offset collector observations only after the edit horizon closes', async function() {
        let clock=Date.now();
        const sink=canonicalMetrics(url,domain,{cleanupIntervalMs:0,now:()=>{return clock;}});
        const samples=[0,37,100,137,200,237].map(ts=>{return point('thin',ts,42);});
        try {
            await sink.write(samples);
            assert.equal((await rows('thin')).length,6,'Recent observations retain full density for late changes');
            await sink.write([point('thin',4000,42)]);
            assert.deepEqual(await rows('thin'),[{ts:0,value:42},{ts:237,value:42},{ts:4000,value:42}]);
            clock+=180000;await sink.runCompaction();
            clock+=180000;await sink.runCompaction();
            await client.command({query:'OPTIMIZE TABLE scada.metrics_points_v4 FINAL'});
            const result=await client.query({query:"SELECT count() n FROM scada.metrics_points_v4 WHERE topic='thin'",format:'JSONEachRow'});
            assert.equal(Number((await result.json())[0].n),3,'Actual point rows must disappear; a thin SELECT alone is insufficient');
            await sink.write([point('thin',100,99),point('thin',150,80)]);
            assert.deepEqual(await rows('thin'),[{ts:0,value:42},{ts:237,value:42},{ts:4000,value:42}],'No old update or addition may change frozen history');
        } finally {await sink.stop();}
    });
    it('retains every spike and return in a mixed window, including changes delivered before sealing', async function() {
        let clock=Date.now();
        const sink=canonicalMetrics(url,domain,{cleanupIntervalMs:0,now:()=>{return clock;}});
        const expected=[{ts:0,value:42},{ts:100,value:42},{ts:150,value:80},{ts:200,value:42},{ts:250,value:90},{ts:300,value:42}];
        try {
            await sink.write(expected.filter(({ts})=>{return ts!==150&&ts!==250;}).map(({ts,value})=>{return point('spikes',ts,value);}));
            await sink.write([point('spikes',150,80),point('spikes',250,90)]);
            assert.deepEqual(await rows('spikes'),expected);
            await sink.write([point('spikes',4000,42)]);clock+=180000;await sink.runCompaction();
            assert.deepEqual((await rows('spikes')).filter(({ts})=>{return ts<1000;}),expected);
        } finally {await sink.stop();}
    });
    it('uses native last-admission winners across restart and preserves legacy history', async function() {
        await client.insert({table:'scada.metrics',values:[{topic:'legacy',ts:new Date(BASE+1000).toISOString().replace('T',' ').replace('Z',''),value:8}],format:'JSONEachRow'});
        const first=canonicalMetrics(url,domain);
        await first.write([point('legacy',1000,9),point('legacy',2000,10)]);await first.stop();
        const restarted=canonicalMetrics(url,domain);
        try {
            await restarted.write([point('legacy',2000,99)]);
            assert.deepEqual(await rows('legacy'),[{ts:1000,value:8},{ts:2000,value:99}]);
        } finally {await restarted.stop();}
    });
    it('records old and future rejections without letting a future clock advance the frontier', async function() {
        const sink=canonicalMetrics(url,domain);
        try {
            await sink.write([point('age',0,42)]);
            await sink.write([point('age',-40*86400000,99),point('age',7200000,80)]);
            await sink.write([point('age',100,43)]);
            assert.deepEqual(await rows('age'),[{ts:0,value:42},{ts:100,value:43}]);
            const result=await client.query({query:"SELECT reason FROM scada.metrics_rejected_v4 FINAL WHERE topic='age' ORDER BY reason",format:'JSONEachRow'});
            assert.deepEqual((await result.json()).map(({reason})=>{return reason;}),['future','too_old']);
        } finally {await sink.stop();}
    });
    it('does not thin point storage when the topic disables compaction', async function() {
        const sink=canonicalMetrics(url,domain);
        const input=[point('exact',0,42,0),point('exact',1,43,0),point('exact',2,42,0),point('exact',4000,44,0)];
        try {await sink.write(input);assert.deepEqual(await rows('exact'),input.map(({ts,value})=>{return {ts:ts-BASE,value};}));}
        finally {await sink.stop();}
    });
    it('rejects a second admission domain before it can race the existing first-value winner', async function() {
        const sink = canonicalMetrics(url, admissionDomain(broker, 'wrong-queue', targetIdentity(url)));
        try { await assert.rejects(sink.write([point('foreign', 0, 9)]), /admission domain/u); }
        finally { await sink.stop(); }
        assert.deepEqual(await rows('foreign'), []);
    });
    it('queues concurrent collectors through one SAC head and preserves last-admission winners across restarts', async function() {
        const a = centralMetricsSink(env());
        const b = centralMetricsSink(env());
        await Promise.all([a.start(), b.start()]);
        try {
            await a.write([point('queued', 0, 7)]);
            await Promise.all([1, 2, 3].map((value) => { return b.write([point('queued', 0, value)]); }));
            await b.write([point('queued',0,9)]);
            await eventually(() => { return rows('queued'); }, [{ ts: 0, value: 9 }]);
            await a.stop();
            await b.write([point('queued', 0, 10), point('queued', 1, 8)]);
            await eventually(() => { return rows('queued'); }, [{ ts: 0, value: 10 }, { ts: 1, value: 8 }]);
        } finally { await Promise.allSettled([a.stop(), b.stop()]); }
    });
    it('preserves native last-wins through actual AMQP telemetry and sync normalization paths', async function() {
        const sink = centralMetricsSink(env()); await sink.start();
        await channel.assertQueue('central-source', { durable: true });
        await channel.assertExchange('central-source-telemetry','topic',{durable:true});
        await channel.bindQueue('central-source','central-source-telemetry','source');
        const ingest = amqpMetricsIngest(broker, 'central-source', sink, { size: 1, prefetch: 1 });
        await ingest.start();
        try {
            channel.publish('central-source-telemetry','source', Buffer.from(JSON.stringify({ts:BASE+1000,value:4})), { persistent: true, headers: { 'scada-route': 'source' } });
            await eventually(() => { return rows('source'); }, [{ts:1000,value:4}]);
            channel.publish('central-source-telemetry','source',Buffer.from(JSON.stringify({ts:BASE+1000,value:99})),{persistent:true,headers:{'scada-route':'source'}});
            await eventually(async () => { return (await channel.checkQueue('central-source')).messageCount; }, 0);
            await eventually(()=>{return rows('source');},[{ts:1000,value:99}]);
            const sync = siteSyncTargets({ metrics: sink, topic() { return 'sync'; } });
            await sync.measurements.write('m', { items: [{ key: 'temp', values: [{ timestamp: new Date(BASE+1000).toISOString(), value: 4 }] }] });
            await sync.measurements.write('m', { items: [{ key: 'temp', values: [{ timestamp: new Date(BASE+1000).toISOString(), value: 9 }] }] });
            await eventually(() => { return rows('sync'); }, [{ ts: 1000, value: 9 }]);
        } finally { await ingest.stop(); await sink.stop(); }
    });
    it('keeps recent analytical density and reports unavailability after constant history is sealed', async function() {
        const sink=canonicalMetrics(url,domain);await sink.write([0,1000,2000,3000,4000].map(ts=>{return point('density',ts,42,10000);}));
        const reader=await clickhouseConnection(clickhouse.getHost(),{port:clickhouse.getMappedPort(8123),username:'reader',password:'test'});
        try {
            const range={start:new Date(BASE),end:new Date(BASE+5000)};
            assert.equal((await clickhouseHolds(reader,'density',range,1500,'')).length,1);
            assert((await clickhouseSeries(reader,'density',{start:new Date(BASE+1000),end:new Date(BASE+3000)},1000,'')).length>=3);
            await sink.write([point('density',40000,42,10000)]);
            await assert.rejects(clickhouseHolds(reader,'density',range,1500,''),{code:'SCADA_HISTORY_DENSITY_UNAVAILABLE'});
            const graph=await clickhouseSeries(reader,'density',{start:new Date(BASE+1000),end:new Date(BASE+3000)},1000,'');
            assert.deepEqual(graph.map(({timestamp,value})=>{return {ts:timestamp.getTime()-BASE,value};}),[{ts:1000,value:42},{ts:3000,value:42}],'A chart inside a compacted constant window keeps its constant coverage');
        } finally {await reader.close();await sink.stop();}
    });
    it('fences a former SAC owner paused before the authoritative state SELECT executes',async function(){
        const topic='delayed-state-select';
        const proxy=await centralFaultProxy(url,true,{prefix:'SELECT * FROM scada.metrics_state_v4 FINAL',loseResponse:false});
        const projection=canonicalMetrics(proxy.url,domain);
        const config=centralPolicy(policy);let activeConnection;
        const old=centralQueueSession({url:broker,queue:config.queue,queueOptions:centralQueueOptions(config),target:targetIdentity(url),
            async connect(address){activeConnection=await amqp.connect(address);return activeConnection;}},projection,{failed(){}});
        const standby=centralMetricsSink(env());
        await old.start();await standby.start();
        try{
            await standby.write([point(topic,0,42)]);
            await proxy.blocked;
            await activeConnection.close();
            await standby.write([point(topic,0,99)]);
            await eventually(()=>{return rows(topic);},[{ts:0,value:99}]);
            proxy.release();await proxy.forwarded;await old.stop();
            assert.deepEqual(await rows(topic),[{ts:0,value:99}],
                'A retired delivery must not allocate a newer revision from a delayed state read');
        }finally{proxy.release();await old.stop();await standby.stop();await projection.stop();await proxy.stop();}
    });
    [false,true].forEach((beforeCommit) => { it(`does not let a delayed old INSERT overwrite a newer native winner across failover ${beforeCommit?'before CH commit':'after CH commit'}`, async function() {
        const topic=beforeCommit?'ambiguous-before':'ambiguous-after';
        const proxy = await centralFaultProxy(url,beforeCommit);
        const projection = canonicalMetrics(proxy.url,domain);
        let activeConnection;
        const config = centralPolicy(policy);
        const old = amqpSource(broker,config.queue,{async accept(delivery) {const batch=decodeBatch(delivery.content,targetIdentity(url));await projection.write(batch.records,batch);}},
            {queueOptions:centralQueueOptions(config),prefetch:1,stopTimeoutMs:120000,async connect(address) {activeConnection=await amqp.connect(address);return activeConnection;},onError(){}});
        const standby = centralMetricsSink(env());
        await old.start();await standby.start();
        try {
            await standby.write([point(topic,0,42)]);
            await proxy.blocked;
            await standby.write([point(topic,0,99)]);
            await standby.write([point(topic,1,43)]);
            await activeConnection.close();
            await eventually(() => {return rows(topic);},[{ts:0,value:99},{ts:1,value:43}]);
            await new Promise((resolve) => {setTimeout(resolve,5200);});
            assert(old.active(),'A long in-flight CH operation must not permanently retire recovery after five seconds');
            proxy.release();
            await proxy.forwarded;
            await old.stop();
            assert.deepEqual(await rows(topic),[{ts:0,value:99},{ts:1,value:43}],'A released old INSERT cannot win after a later admitted conflict');
            await client.command({query:`INSERT INTO scada.metrics_points_v4 SELECT * FROM scada.metrics_points_v4 FINAL WHERE topic={topic:String}`,query_params:{topic}});
            await client.command({query:'OPTIMIZE TABLE scada.metrics_points_v4 FINAL'});
            const physical=await client.query({query:"SELECT count() n FROM scada.metrics_points_v4 WHERE topic={topic:String}",query_params:{topic},format:'JSONEachRow'});
            assert.equal(Number((await physical.json())[0].n),2,'Native RMT must remove physical duplicates');
        } finally {
            proxy.release();await old.stop();await standby.stop();await projection.stop();await proxy.stop();
        }
    }); });
    it('rejects queue overflow while retaining its accepted head and ready batch', async function() {
        const queue='central-overflow-test';
        const sink=centralMetricsSink(env({queue,maxPendingBatches:1}));await sink.start();
        try {
            await sink.write([point('overflow-first',0,1)]);
            await eventually(async () => {return Boolean(sink.status().error);},true);
            await sink.write([point('overflow-second',0,2)]);
            await assert.rejects(sink.write([point('overflow-third',0,3)]));
            await sink.stop();
            const first=await channel.get(queue);const second=await channel.get(queue);
            assert(first&&second);
            assert.deepEqual([decodeBatch(first.content,targetIdentity(url)).records[0].topic,decodeBatch(second.content,targetIdentity(url)).records[0].topic],['overflow-first','overflow-second']);
            channel.ack(first);channel.ack(second);
        } finally {await sink.stop();await channel.deleteQueue(queue);}
    });
    it('retains malformed and oversized heads without advancing a later batch', async function() {
        for (const body of ['{}','x'.repeat(MAX_BATCH_BYTES+1)]) {
            const name=body.length>2?'after-oversized':'after-malformed';
            const confirmed=await connection.createConfirmChannel();
            await new Promise((resolve,reject) => {confirmed.sendToQueue('scada.telemetry.canonical',Buffer.from(body),{persistent:true},(error) => {if(error){reject(error);}else{resolve();}});});
            await confirmed.close();
            const sink=centralMetricsSink(env());await sink.start();
            try {
                await sink.write([point(name,0,7)]);
                await eventually(async () => {return Boolean(sink.status().error);},true);
                assert.deepEqual(await rows(name),[]);
            } finally {await sink.stop();}
            const retained=await channel.get('scada.telemetry.canonical');
            assert.equal(retained.content.length,Buffer.byteLength(body));channel.ack(retained);
            const resumed=centralMetricsSink(env());await resumed.start();
            try {await eventually(() => {return rows(name);},[{ts:0,value:7}]);}
            finally {await resumed.stop();}
        }
    });
    it('starts archive recovery in the actual external-mode site composition without a new source delivery', async function() {
        const database = await new GenericContainer('postgres:16-alpine').withEnvironment({POSTGRES_PASSWORD:'test'}).withExposedPorts(5432).start();
        const adminUrl = `postgresql://postgres:test@${database.getHost()}:${database.getMappedPort(5432)}/postgres`;
        const admin = new pg.Pool({connectionString:adminUrl});
        let site;
        try {
            await admin.query("CREATE ROLE supervisor_sink LOGIN PASSWORD 'test'");
            const publisher = await connection.createConfirmChannel();
            await new Promise((resolve,reject) => {publisher.sendToQueue('scada.telemetry.canonical',Buffer.from(encodeBatch([point('site-restart',0,7)],centralPolicy(policy),targetIdentity(url))),{persistent:true},(error) => {if(error){reject(error);}else{resolve();}});});
            await publisher.close();
            await rabbit.exec(['rabbitmqctl','stop_app']);
            site = await siteServer({collectorMode:'external',env:{...env(),SINK_DB_PROFILE:'central',COLLECTOR_MODE:'external',POSTGRES_URL:adminUrl.replace('postgres:test@','supervisor_sink:test@'),POSTGRES_ADMIN_URL:adminUrl,PORT:'0',STATE_HTTP_PORT:'0'},plantFactory() {return {init(){},shops:{get(){return {};}}};}});
            assert.equal(site.telemetry,undefined);
            assert.equal(site.mqtt,undefined);
            assert(site.centralTelemetry);
            assert(site.plant.server.listening,'Read API must boot while RabbitMQ is unavailable');
            await rabbit.exec(['rabbitmqctl','start_app']);
            await eventually(() => {return rows('site-restart');},[{ts:0,value:7}]);
            assert.equal((await admin.query("SELECT to_regclass('central_metric_receipts') AS receipts")).rows[0].receipts,null);
        } finally {
            if(site){await site.centralTelemetry.stop();site.sinkHttp.stop();await new Promise((resolve) => {site.plant.server.close(resolve);});await site.sink.pool.end();}
            await admin.end();await database.stop();
        }
    });
    it('does not permit disabling or bypassing an activated canonical point store', async function() {
        await assert.rejects(centralTelemetryPreflight({ ...env(), CENTRAL_TELEMETRY_POLICY: '{"enabled":false}' }), /cannot be disabled/u);
        await assert.rejects(centralTelemetryPreflight({ CLICKHOUSE_URL: url }), /cannot be disabled/u);
    });
});
