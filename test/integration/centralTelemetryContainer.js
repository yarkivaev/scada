import assert from 'node:assert/strict';
import amqp from 'amqplib';
import pg from 'pg';
import siteServer from '../../src/application/siteServer.js';
import clickhouseSeries from '../../src/infrastructure/persistence/clickhouse/series.js';
import { GenericContainer, Wait } from 'testcontainers';
import { createClient } from '@clickhouse/client';
import canonicalMetrics from '../../src/infrastructure/persistence/clickhouse/canonicalMetrics.js';
import metricsRelation, { rawMetricsRelation } from '../../src/infrastructure/persistence/clickhouse/metricsRelation.js';
import clickhouseHolds from '../../src/infrastructure/persistence/clickhouse/holds.js';
import clickhouseConnection from '../../src/infrastructure/persistence/clickhouse/connection.js';
import centralMetricsSink from '../../src/infrastructure/ingest/telemetry/centralMetricsSink.js';
import centralTelemetryPreflight from '../../src/infrastructure/ingest/telemetry/centralTelemetryPreflight.js';
import centralPolicy from '../../src/infrastructure/ingest/telemetry/centralPolicy.js';
import { admissionDomain, targetIdentity, encodeBatch, decodeBatch, MAX_BATCH_BYTES } from '../../src/infrastructure/ingest/telemetry/centralEnvelope.js';
import amqpMetricsIngest from '../../src/infrastructure/ingest/telemetry/amqpMetricsIngest.js';
import siteSyncTargets from '../../src/application/sync/siteSyncTargets.js';
import amqpSource from '../../src/infrastructure/streams/amqpSource.js';
import {centralQueueOptions} from '../../src/infrastructure/ingest/telemetry/centralQueueSession.js';

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

describe('ClickHouse ordered central admission and adaptive thinning', function() {
    this.timeout(180000);
    let clickhouse;
    let rabbit;
    let client;
    let url;
    let broker;
    let connection;
    let channel;
    let domain;
    const policy = { enabled: true, topics: [{ topic: 'thin', thinWindowMs: 1000 }] };
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
    });
    after(async function() {
        await Promise.allSettled([connection?.close(), client?.close()]);
        await Promise.allSettled([clickhouse?.stop(), rabbit?.stop()]);
    });
    async function rows(topic) {
        const response = await client.query({ query: `SELECT toUnixTimestamp64Milli(ts) AS ts,value FROM ${metricsRelation} WHERE topic={topic:String} ORDER BY ts`, query_params: { topic }, format: 'JSONEachRow' });
        return (await response.json()).map((row) => { return { ts: Number(row.ts), value: row.value }; });
    }
    function point(topic, ts, value, thinWindowMs = 0) { return { topic, ts, value, thinWindowMs }; }
    it('keeps legacy-only read-only consumers working before additive schema installation', async function() {
        await client.command({ query: "CREATE USER reader IDENTIFIED BY 'test'" });
        await client.command({ query: 'GRANT SELECT ON scada.* TO reader' });
        const reader = await clickhouseConnection(clickhouse.getHost(), { port: clickhouse.getMappedPort(8123), username: 'reader', password: 'test' });
        try { assert.deepEqual(await reader.query('SELECT * FROM scada.metrics_read'), []); }
        finally { await reader.close(); }
    });
    it('physically compacts equal values but restores every old timestamp when a different late value arrives', async function() {
        const sink = canonicalMetrics(url, domain);
        try {
            await sink.write([point('thin', 0, 42, 1000), point('thin', 100, 42, 1000), point('thin', 200, 42, 1000), point('thin', 400, 42, 1000)]);
            assert.deepEqual(await rows('thin'), [{ ts: 0, value: 42 }, { ts: 400, value: 42 }]);
            await sink.write([point('thin', 100, 99, 1000)]);
            assert.deepEqual(await rows('thin'), [{ ts: 0, value: 42 }, { ts: 400, value: 42 }]);
            await sink.write([point('thin', 150, 43, 1000)]);
            assert.deepEqual(await rows('thin'), [{ ts: 0, value: 42 }, { ts: 100, value: 42 }, { ts: 150, value: 43 }, { ts: 200, value: 42 }, { ts: 400, value: 42 }]);
            await sink.write([point('thin', 100, 99, 0)]);
            assert.equal((await rows('thin'))[1].value, 42, 'Changing policy cannot overwrite an earlier observation');
            await client.command({query:'OPTIMIZE TABLE scada.metrics_compact_v2 FINAL'});
            const result = await client.query({ query: "SELECT count() AS n FROM scada.metrics_compact_v2 WHERE topic='thin'", format: 'JSONEachRow' });
            assert.equal(Number((await result.json())[0].n), 2);
        } finally { await sink.stop(); }
    });
    it('uses one physical minute group independently of the adaptive output window', async function() {
        const sink=canonicalMetrics(url,domain);
        const thinned=Array.from({length:600},(unused,index) => {return point('physical-thin',index*100,42,1000);});
        const exact=thinned.map(({ts,value}) => {return point('physical-exact',ts,value,0);});
        try {
            await sink.write(thinned);await sink.write(exact);
            await client.command({query:'OPTIMIZE TABLE scada.metrics_compact_v2 FINAL'});
            const query=await client.query({query:"SELECT topic,count() AS n FROM scada.metrics_compact_v2 WHERE topic IN ('physical-thin','physical-exact') GROUP BY topic ORDER BY topic",format:'JSONEachRow'});
            assert.deepEqual((await query.json()).map(({n:count}) => {return Number(count);}),[1,1]);
            assert.equal((await rows('physical-thin')).length,120);
            assert.equal((await rows('physical-exact')).length,600);
            await sink.write([point('negative-window',-1001,42,1000),point('negative-window',-1000,42,1000),point('negative-window',-999,42,1000)]);
            assert.deepEqual((await rows('negative-window')).map(({ts}) => {return ts;}),[-1001,-1000,-999]);
        } finally {await sink.stop();}
    });
    it('retains all distinct points without thinning, including 42->43->42 returns and epoch boundaries', async function() {
        const sink = canonicalMetrics(url, domain);
        const input = [point('exact', -2208988800000, 42), point('exact', 0, 43), point('exact', 1, 42), point('exact', 10413791999999, 44)];
        try { await sink.write(input); assert.deepEqual(await rows('exact'), input.map(({ ts, value }) => { return { ts, value }; })); }
        finally { await sink.stop(); }
    });
    it('does not rewrite legacy history and ignores conflicting timestamps after restart', async function() {
        await client.insert({ table: 'scada.metrics', values: [{ topic: 'legacy', ts: '1970-01-01 00:00:01.000', value: 8 }], format: 'JSONEachRow' });
        const first = canonicalMetrics(url, domain);
        await first.write([point('legacy', 1000, 9), point('legacy', 2000, 10)]); await first.stop();
        const restarted = canonicalMetrics(url, domain);
        try { await restarted.write([point('legacy', 2000, 99)]); assert.deepEqual(await rows('legacy'), [{ ts: 1000, value: 8 }, { ts: 2000, value: 10 }]); }
        finally { await restarted.stop(); }
    });
    it('rejects a second admission domain before it can race the existing first-value winner', async function() {
        const sink = canonicalMetrics(url, admissionDomain(broker, 'wrong-queue', targetIdentity(url)));
        try { await assert.rejects(sink.write([point('foreign', 0, 9)]), /admission domain/u); }
        finally { await sink.stop(); }
        assert.deepEqual(await rows('foreign'), []);
    });
    it('queues concurrent collectors through one SAC head and retains the first value across worker restarts', async function() {
        const a = centralMetricsSink(env());
        const b = centralMetricsSink(env());
        await Promise.all([a.start(), b.start()]);
        try {
            await a.write([point('queued', 0, 7)]);
            await Promise.all([1, 2, 3].map((value) => { return b.write([point('queued', 0, value)]); }));
            await eventually(() => { return rows('queued'); }, [{ ts: 0, value: 7 }]);
            await a.stop();
            await b.write([point('queued', 0, 9), point('queued', 1, 8)]);
            await eventually(() => { return rows('queued'); }, [{ ts: 0, value: 7 }, { ts: 1, value: 8 }]);
        } finally { await Promise.allSettled([a.stop(), b.stop()]); }
    });
    it('preserves first-wins through the actual AMQP telemetry and sync normalization paths', async function() {
        const sink = centralMetricsSink(env()); await sink.start();
        await channel.assertQueue('central-source', { durable: true });
        await channel.assertExchange('central-source-telemetry','topic',{durable:true});
        await channel.bindQueue('central-source','central-source-telemetry','source');
        const ingest = amqpMetricsIngest(broker, 'central-source', sink, { size: 1, prefetch: 1 });
        await ingest.start();
        try {
            channel.publish('central-source-telemetry','source', Buffer.from('{"ts":1000,"value":4}'), { persistent: true, headers: { 'scada-route': 'source' } });
            await eventually(() => { return rows('source'); }, [{ts:1000,value:4}]);
            channel.publish('central-source-telemetry','source',Buffer.from('{"ts":1000,"value":99}'),{persistent:true,headers:{'scada-route':'source'}});
            await eventually(async () => { return (await channel.checkQueue('central-source')).messageCount; }, 0);
            assert.deepEqual(await rows('source'),[{ts:1000,value:4}]);
            const sync = siteSyncTargets({ metrics: sink, topic() { return 'sync'; } });
            await sync.measurements.write('m', { items: [{ key: 'temp', values: [{ timestamp: '1970-01-01T00:00:01.000Z', value: 4 }] }] });
            await sync.measurements.write('m', { items: [{ key: 'temp', values: [{ timestamp: '1970-01-01T00:00:01.000Z', value: 9 }] }] });
            await eventually(() => { return rows('sync'); }, [{ ts: 1000, value: 4 }]);
        } finally { await ingest.stop(); await sink.stop(); }
    });
    it('preserves late returns across changed policy windows while future non-overlapping windows still thin', async function() {
        const sink = canonicalMetrics(url,domain);
        try {
            await sink.write([100,200,600,900].map((ts) => {return point('policy-change',ts,42,1000);}));
            await sink.write([point('policy-change',150,43,500),point('policy-change',550,43,500)]);
            assert.deepEqual((await rows('policy-change')).map(({ts}) => {return ts;}),[100,150,200,550,600,900]);
            await sink.write([2100,2200,2400].map((ts) => {return point('policy-change',ts,42,500);}));
            assert.deepEqual((await rows('policy-change')).filter(({ts}) => {return ts>=2000;}).map(({ts}) => {return ts;}),[2100,2400]);
        } finally {await sink.stop();}
    });
    it('preserves full timestamp density for analytical holds even when the plot is thinned', async function() {
        const sink = canonicalMetrics(url,domain);
        await sink.write([0,1000,2000,3000,4000].map((ts) => {return point('density',ts,42,10000);}));
        await sink.stop();
        assert.equal((await rows('density')).length,2);
        const query = await client.query({query:`SELECT count() AS n FROM ${rawMetricsRelation} WHERE topic='density'`,format:'JSONEachRow'});
        assert.equal(Number((await query.json())[0].n),5);
        const reader = await clickhouseConnection(clickhouse.getHost(),{port:clickhouse.getMappedPort(8123),username:'reader',password:'test'});
        try {
            const holds = await clickhouseHolds(reader,'density',{start:new Date(0),end:new Date(5000)},1500,'');
            assert.equal(holds.length,1);
            const middle = await clickhouseSeries(reader,'density',{start:new Date(1000),end:new Date(3000)},1000,'');
            assert(middle.length>=3,'A bounded middle-of-window read cannot disappear between adaptive endpoints');
        } finally {await reader.close();}
    });
    [false,true].forEach((beforeCommit) => { it(`keeps the unacknowledged head first across failover ${beforeCommit?'before CH commit':'after CH commit'}`, async function() {
        const topic=beforeCommit?'ambiguous-before':'ambiguous-after';
        const proxy = await centralFaultProxy(url,beforeCommit);
        const projection = canonicalMetrics(proxy.url,domain);
        let activeConnection;
        const config = centralPolicy(policy);
        const old = amqpSource(broker,config.queue,{async accept(delivery) {await projection.write(decodeBatch(delivery.content,targetIdentity(url)));}},
            {queueOptions:centralQueueOptions(config),prefetch:1,stopTimeoutMs:120000,async connect(address) {activeConnection=await amqp.connect(address);return activeConnection;},onError(){}});
        const standby = centralMetricsSink(env());
        await old.start();await standby.start();
        try {
            await standby.write([point(topic,0,42)]);
            await proxy.blocked;
            await standby.write([point(topic,0,99)]);
            await standby.write([point(topic,1,43)]);
            await activeConnection.close();
            await eventually(() => {return rows(topic);},[{ts:0,value:42},{ts:1,value:43}]);
            await new Promise((resolve) => {setTimeout(resolve,5200);});
            assert(old.active(),'A long in-flight CH operation must not permanently retire recovery after five seconds');
            proxy.release();
            await proxy.forwarded;
            await old.stop();
            await client.command({query:`INSERT INTO scada.metrics_compact_v2 SELECT {topic:String},0,60000,0,42,groupBitmapState(toUInt64(0))`,query_params:{topic}});
            await client.command({query:'OPTIMIZE TABLE scada.metrics_compact_v2 FINAL'});
            const physical = await client.query({query:"SELECT count() AS n FROM scada.metrics_compact_v2 WHERE topic={topic:String}",query_params:{topic},format:'JSONEachRow'});
            assert.equal(Number((await physical.json())[0].n),2,'A retry must not leave permanent physical duplicate states');
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
            assert.deepEqual([decodeBatch(first.content,targetIdentity(url))[0].topic,decodeBatch(second.content,targetIdentity(url))[0].topic],['overflow-first','overflow-second']);
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
    it('does not permit disabling or bypassing an activated canonical journal', async function() {
        await assert.rejects(centralTelemetryPreflight({ ...env(), CENTRAL_TELEMETRY_POLICY: '{"enabled":false}' }), /cannot be disabled/u);
        await assert.rejects(centralTelemetryPreflight({ CLICKHOUSE_URL: url }), /cannot be disabled/u);
    });
});
