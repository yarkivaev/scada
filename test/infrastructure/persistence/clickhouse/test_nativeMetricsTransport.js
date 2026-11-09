import assert from 'node:assert/strict';
import {PassThrough,Readable} from 'node:stream';
import {setImmediate} from 'node:timers/promises';
import admission from '../../../../src/infrastructure/persistence/clickhouse/nativeMetricsAdmission.js';

const point={topic:'unit',ts:19000,value:1.586,compactWindowMs:1000,historyWindowMs:10000,maxHistoryAgeMs:100000,futureSkewMs:1000};
const context={admittedAt:20000,batchId:'a'.repeat(64)};
function client(response=Readable.from([])) {
    const writes=[];let payload;
    return {writes,get payload(){return payload;},query:async()=>{return {json:async()=>{return [];}};},
        insert:async(request)=>{writes.push(request);},
        exec:async(request)=>{const chunks=[];for await(const chunk of request.values){chunks.push(chunk);}payload=Buffer.concat(chunks);return {stream:response};}};
}
describe('native central Float64 transport',function(){
    it('persists the frozen max-gap policy alongside each ordinary point',async()=>{
        const target=client();await admission(target,[{...point,maxGapMs:1234}],context,{now:()=>{return 20000}});
        assert.equal(target.payload.readBigUInt64LE(target.payload.length-8),1234n);
    });

    it('keeps exact Float64 bytes at the ClickHouse boundary',async()=>{
        const target=client();await admission(target,[point],context,{now:()=>{return 20000;}});
        assert.ok(target.payload,'Numeric JSON cannot guarantee the source Float64 bits at ClickHouse input');
        assert.equal(target.payload.subarray(13,21).toString('hex'),'c74b37894160f93f');
        assert.equal(target.payload.readBigInt64LE(5),19000n);
    });
    it('retains multi-byte topic lengths and revisions exceeding UInt64',async()=>{
        const target=client();target.query=async()=>{return {json:async()=>{return [{key:'',committed_seq:'9223372036854775807'}];}};};
        await admission(target,[{...point,topic:'é'.repeat(64)}],context,{now:()=>{return 20000;}});
        assert.equal(target.payload.subarray(0,2).toString('hex'),'8001');
        assert.equal(target.payload.subarray(2,130).toString(),'é'.repeat(64));
        assert.equal(target.payload.readBigUInt64LE(154),0n);assert.equal(target.payload.readBigUInt64LE(162),512n);
    });
    it('does not commit the queue cursor before the insertion body completes',async()=>{
        const response=new PassThrough();const target=client(response);
        const pending=admission(target,[point],context,{now:()=>{return 20000;}});
        await setImmediate();assert.equal(target.writes.length,0,'Admission cursor advanced while ClickHouse response was incomplete');
        response.end();await pending;assert.equal(target.writes.at(-1).table,'scada.metrics_state_v4');
    });
    it('never commits after an insertion error arrives in a successful HTTP body',async()=>{
        const target=client(Readable.from([Buffer.from('Code: 241 late storage error')]));
        await assert.rejects(admission(target,[point],context,{now:()=>{return 20000;}}));
        assert.equal(target.writes.length,0);
    });
});
