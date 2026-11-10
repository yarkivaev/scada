import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import admission from '../../../../src/infrastructure/persistence/clickhouse/nativeMetricsAdmission.js';

function memory() {
    const writes=[];
    const client={ writes, query:async () => {return {json:async () => {return []}}}, insert:async (request) => { writes.push(request); } };
    client.exec=async(request)=>{
        const chunks=[];for await(const chunk of request.values){chunks.push(chunk);}const data=Buffer.concat(chunks);const rows=[];let offset=0;
        while(offset<data.length){
            let length=0;let shift=0;let byte;
            do{byte=data[offset];offset+=1;length+=(byte%128)*(2**shift);shift+=7;}while(byte>=128);
            const topic=data.subarray(offset,offset+length).toString();offset+=length;
            const ts=new Date(Number(data.readBigInt64LE(offset))).toISOString().replace('T',' ').slice(0,-1);offset+=8;
            const value=data.readDoubleLE(offset);offset+=8;const compact_ms=Number(data.readBigUInt64LE(offset));offset+=8;
            const revision=(data.readBigUInt64LE(offset)+(data.readBigUInt64LE(offset+8)*(2n**64n))).toString();offset+=16;
            offset+=25;const max_gap_ms=Number(data.readBigUInt64LE(offset));offset+=8;rows.push({topic,ts,value,compact_ms,revision,max_gap_ms});
        }
        await client.insert({table:'scada.metrics_points_v4',values:rows});return {stream:Readable.from([])};
    };
    return client;
}
const policy={compactWindowMs:1000,historyWindowMs:10000,maxHistoryAgeMs:100000,futureSkewMs:1000};
const point=(ts,value=42) => {return {topic:'sensor',ts,value,...policy}};
describe('native central admission',function() {
    it('writes last input ordinal with increasing native revisions before state',async function() {
        const client=memory();
        await admission(client,[point(1000,1),point(1000,2)],{admittedAt:1000,batchId:'a'.repeat(64)},{now:()=>{return 2000}});
        assert.equal(client.writes[0].table,'scada.metrics_points_v4');
        assert.deepEqual(client.writes[0].values.map(({value,revision}) => {return {value,revision}}),[{value:2,revision:'1025'}]);
        assert.equal(client.writes.at(-1).table,'scada.metrics_state_v4');
    });
    it('rejects future clocks before computing a frontier and durably records old points',async function() {
        const client=memory();
        await admission(client,[point(0),point(20000),point(1000000)],{admittedAt:20000,batchId:'b'.repeat(64)},{now:()=>{return 20000}});
        assert.deepEqual(client.writes[0].values.map(({value,ts}) => {return {value,ts}}),[{value:42,ts:'1970-01-01 00:00:20.000'}]);
        assert.deepEqual(client.writes[1].values.map(({reason}) => {return reason}),['too_old','future']);
        const state=client.writes[2].values.find(({key})=>{return key==='topic:sensor'});
        assert.equal(state.closed_before,10000);assert.equal(state.latest,20000);
    });
    it('does not publish metadata after a failed diagnostic insert',async function() {
        const client=memory();client.insert=async ({table})=>{if(table==='scada.metrics_rejected_v4'){throw Error('unavailable');}client.writes.push(table);};
        await assert.rejects(admission(client,[point(1000000)],{admittedAt:20000,batchId:'c'.repeat(64)}),/unavailable/u);
        assert(!client.writes.includes('scada.metrics_state_v4'));
    });
    it('keeps a committed frontier after policy expansion and ignores future high watermarks',async function() {
        const client=memory();
        client.query=async()=>{return {json:async()=>{return [
            {key:'',committed_seq:'8'},
            {key:'topic:sensor',latest:'30000',closed_before:'20000',published_at:'9000'}
        ]}}};
        await admission(client,[{...point(15000,99),historyWindowMs:1000000},point(1000000)],{admittedAt:30000,batchId:'d'.repeat(64)},{now:()=>{return 31000}});
        assert.equal(client.writes[0].table,'scada.metrics_rejected_v4');
        const state=client.writes.at(-1).values.find(({key})=>{return key==='topic:sensor';});
        assert.equal(state.latest,30000);assert.equal(state.closed_before,20000);assert.equal(state.published_at,9000);
        assert.equal(state.revision,'10239');
    });
    it('publishes cleanup grace only after point durability',async function() {
        const client=memory();let clock=20000;
        const insert=client.insert;
        client.insert=async(request)=>{await insert(request);if(request.table==='scada.metrics_points_v4'){clock=90000;}};
        await admission(client,[point(20000)],{admittedAt:20000,batchId:'e'.repeat(64)},{now:()=>{return clock}});
        const state=client.writes.at(-1).values.find(({key})=>{return key==='topic:sensor';});
        assert.equal(state.published_at,90000);
    });

    it('enforces the calendar age cap inside a rounded sealing boundary',async function(){
        const client=memory();
        await admission(client,[{...point(10200),maxHistoryAgeMs:1000}],{admittedAt:11500,batchId:'f'.repeat(64)},{now:()=>{return 11500}});
        assert.equal(client.writes[0].table,'scada.metrics_rejected_v4');
        assert.equal(client.writes[0].values[0].reason,'too_old');
    });

    it('fences a former owner whose delayed state read observes newer committed admissions',async function(){
        const client=memory();let current=[];let release;let entered;let active=true;
        const blocked=new Promise(resolve=>{entered=resolve;});
        const gate=new Promise(resolve=>{release=resolve;});
        client.query=async()=>{return {json:async()=>{return structuredClone(current);}};};
        const insert=client.insert;
        client.insert=async(request)=>{await insert(request);if(request.table==='scada.metrics_state_v4'){current=request.values;}};
        const former={...client,async query(request){entered();await gate;return client.query(request);}};
        const stale=admission(former,[point(1000,42)],{admittedAt:1000,batchId:'1'.repeat(64),active:()=>{return active;}},{now:()=>{return 2000;}})
            .then(()=>{return null},error=>{return error});
        await blocked;active=false;
        await admission(client,[point(1000,42)],{admittedAt:1000,batchId:'1'.repeat(64)},{now:()=>{return 2000;}});
        await admission(client,[point(1000,99)],{admittedAt:1000,batchId:'2'.repeat(64)},{now:()=>{return 2000;}});
        release();const error=await stale;
        const points=client.writes.filter(request=>{return request.table==='scada.metrics_points_v4';}).flatMap(request=>{return request.values;});
        const winner=points.reduce((left,right)=>{return BigInt(left.revision)>BigInt(right.revision)?left:right;});
        assert.equal(winner.value,99);
        assert.match(error?.message??'',/ownership/u);
        assert.equal(current.find(row=>{return row.key==='';}).committed_seq,'2');
    });

    it('rejects direct windows exceeding the bounded reader certificate expansion',async function(){
        const client=memory();
        await assert.rejects(admission(client,[{...point(1000),compactWindowMs:3600001}],{admittedAt:1000,batchId:'f'.repeat(64)},{now:()=>{return 1000}}),/compactWindowMs/u);
        assert.equal(client.writes.length,0);
    });

});
