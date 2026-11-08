import assert from 'node:assert/strict';
import admission from '../../../../src/infrastructure/persistence/clickhouse/nativeMetricsAdmission.js';

function memory() {
    const writes=[];
    return { writes, query:async () => {return {json:async () => {return []}}}, insert:async (request) => { writes.push(request); } };
}
const policy={compactWindowMs:1000,historyWindowMs:10000,maxHistoryAgeMs:100000,futureSkewMs:1000};
const point=(ts,value=42) => {return {topic:'sensor',ts,value,...policy}};
describe('native central admission',function() {
    it('writes last input ordinal with increasing native revisions before state',async function() {
        const client=memory();
        await admission(client,[point(1000,1),point(1000,2)],{admittedAt:1000,batchId:'a'.repeat(64)},{now:()=>{return 2000}});
        assert.equal(client.writes[0].table,'scada.metrics_points_v3');
        assert.deepEqual(client.writes[0].values.map(({value,revision}) => {return {value,revision}}),[{value:2,revision:'1025'}]);
        assert.equal(client.writes.at(-1).table,'scada.metrics_state_v3');
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
        const client=memory();client.insert=async ({table})=>{if(table==='scada.metrics_rejected_v3'){throw Error('unavailable');}client.writes.push(table);};
        await assert.rejects(admission(client,[point(1000000)],{admittedAt:20000,batchId:'c'.repeat(64)}),/unavailable/u);
        assert(!client.writes.includes('scada.metrics_state_v3'));
    });
    it('keeps a committed frontier after policy expansion and ignores future high watermarks',async function() {
        const client=memory();
        client.query=async()=>{return {json:async()=>{return [
            {key:'',committed_seq:'8'},
            {key:'topic:sensor',latest:'30000',closed_before:'20000',published_at:'9000'}
        ]}}};
        await admission(client,[{...point(15000,99),historyWindowMs:1000000},point(1000000)],{admittedAt:30000,batchId:'d'.repeat(64)},{now:()=>{return 31000}});
        assert.equal(client.writes[0].table,'scada.metrics_rejected_v3');
        const state=client.writes.at(-1).values.find(({key})=>{return key==='topic:sensor';});
        assert.equal(state.latest,30000);assert.equal(state.closed_before,20000);assert.equal(state.published_at,9000);
        assert.equal(state.revision,'10239');
    });
    it('publishes cleanup grace only after point durability',async function() {
        const client=memory();let clock=20000;
        const insert=client.insert;
        client.insert=async(request)=>{await insert(request);if(request.table==='scada.metrics_points_v3'){clock=90000;}};
        await admission(client,[point(20000)],{admittedAt:20000,batchId:'e'.repeat(64)},{now:()=>{return clock}});
        const state=client.writes.at(-1).values.find(({key})=>{return key==='topic:sensor';});
        assert.equal(state.published_at,90000);
    });

    it('enforces the calendar age cap inside a rounded sealing boundary',async function(){
        const client=memory();
        await admission(client,[{...point(10200),maxHistoryAgeMs:1000}],{admittedAt:11500,batchId:'f'.repeat(64)},{now:()=>{return 11500}});
        assert.equal(client.writes[0].table,'scada.metrics_rejected_v3');
        assert.equal(client.writes[0].values[0].reason,'too_old');
    });

    it('rejects direct windows exceeding the bounded reader certificate expansion',async function(){
        const client=memory();
        await assert.rejects(admission(client,[{...point(1000),compactWindowMs:3600001}],{admittedAt:1000,batchId:'f'.repeat(64)},{now:()=>{return 1000}}),/compactWindowMs/u);
        assert.equal(client.writes.length,0);
    });

});
