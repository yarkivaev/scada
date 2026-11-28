import assert from 'node:assert/strict';
import {PassThrough,Readable} from 'node:stream';
import {setImmediate} from 'node:timers/promises';
import metrics from '../../../../src/infrastructure/persistence/clickhouse/metricsState.js';

async function bytes(stream) {const chunks=[];for await(const chunk of stream){chunks.push(chunk);}return Buffer.concat(chunks);}
function packet(action) {return {async exec(request){await action(request);return {stream:Readable.from([])};}};}
describe('ClickHouse telemetry transport',()=>{
    it('cannot truncate a PostgreSQL microsecond timestamp during insertion',async()=>{
        let payload;
        await metrics(packet(async request=>{payload=await bytes(request.values);})).insertRows([{topic:'unit',ts:'2026-11-03T12:00:00.123456Z',value:17}]);
        assert.equal(payload.readBigInt64LE(5),1793707200123456n,'Raw insertion truncated the source timestamp');
    });
    it('cannot acknowledge an insertion rejected by ClickHouse',async()=>{
        await assert.rejects(metrics({async exec(){throw new Error('rejected');}}).insertRows([{topic:'unit',ts:new Date(),value:3}]),'Insertion acknowledged a failed durable write');
    });
    it('cannot return an empty checkpoint query as a backend request',async()=>{
        assert.deepEqual(await metrics({}).readings([],0),[],'Empty checkpoint topic selection reached ClickHouse');
    });
    it('selects the configured checkpoint source as a ClickHouse identifier',async()=>{
        const calls=[];
        const port=metrics({async query(request){
            calls.push(request);
            return {async json(){return [];}};
        }},{readingsTable:'site_replay_readings'});
        await port.readings(['signal'],0);
        await port.latestForTopic('signal');
        assert.match(calls[0].query,/FROM scada\.\{source:Identifier\}/u);
        assert.equal(calls[0].query_params.source,'site_replay_readings');
        assert.match(calls[1].query,/FROM scada\.metrics/u);
    });
    it('cannot expose a string rising prefix to the sensor port',async()=>{
        const rows=await metrics({async query(){return {async json(){return [{ts:'2026-11-03 12:00:00.001001',prefix:'2'}];}};}}).risesForTopic('unit','2026-11-03T12:00:00Z','2026-11-03T12:00:01Z');
        assert.deepEqual(rows.map(row=>{return row.value}),[2],'Rising prefix was not mapped to the metrics state value');
    });
    it('cannot serialize negative zero into the positive zero raw variant',async()=>{
        let payload;
        await metrics(packet(async request=>{payload=await bytes(request.values);})).insertRows([{topic:'unit',ts:0,value:-0},{topic:'unit',ts:0,value:0}]);
        assert.deepEqual([payload.readBigUInt64LE(13),payload.readBigUInt64LE(34)],[9223372036854775808n,0n],'Raw serialization discarded the negative zero value bits');
    });
    it('cannot accept a late error body after successful response headers',async()=>{
        await assert.rejects(metrics({async exec(){return {stream:Readable.from([Buffer.from('Code: 241 late server failure')])};}}).insertRows([{topic:'unit',ts:0,value:1.586}]),'Late ClickHouse error body was acknowledged');
    });
    it('cannot acknowledge before the complete response has ended',async()=>{
        const stream=new PassThrough();let complete=false;
        const pending=metrics({async exec(){return {stream};}}).insertRows([{topic:'unit',ts:0,value:1.586}]).then(()=>{complete=true;});
        await setImmediate();const before=complete;stream.end();await pending;
        assert.deepEqual([before,complete],[false,true],'Headers acknowledged insertion before response completion');
    });
    it('cannot retain an open response stream after abort',async()=>{
        const stream=new PassThrough();const controller=new AbortController();
        const pending=metrics({async exec(){return {stream};}}).insertRows([{topic:'unit',ts:0,value:1.586}],{signal:controller.signal}).then(()=>{return false},()=>{return true});
        await setImmediate();controller.abort(new Error('cancelled'));
        assert.deepEqual([await pending,stream.destroyed],[true,true],'Aborted insertion left its response open or acknowledged');
    });
    it('cannot lose synchronous acknowledgement settings or request cancellation',async()=>{
        const controller=new AbortController();let request;
        await metrics(packet(async value=>{request=value;await bytes(value.values);})).insertRows([{topic:'unit',ts:0,value:1.586}],{signal:controller.signal});
        assert.deepEqual([request.query,request.abort_signal===controller.signal,request.clickhouse_settings],['INSERT INTO scada.metrics (topic, ts, value) FORMAT RowBinary',true,{'wait_end_of_query':1,'async_insert':0}],'Binary insert lost explicit column order, synchronous storage or cancellation');
    });
});
