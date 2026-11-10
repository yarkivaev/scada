import assert from 'node:assert/strict';
import historyContext from '../../../../src/infrastructure/persistence/pg/historyContext.js';

// The external backend owns raw observations; PostgreSQL owns only domain state.
describe('historical context with external observations', function() {
    const pool = {async query(sql) {
        if (/history_observations/u.test(sql)) { throw new Error('Raw observation table must not be read for external history'); }
        if (/FROM segments|FROM history_annotations/u.test(sql)) { return {rows:[],rowCount:0}; }
        throw new Error(`Unexpected domain-state query: ${sql}`);
    }};
    const source = {
        async boundary() { return 3000; },
        async page() { return {from:0,until:3000,next:null,end:3000}; },
        async read() { return {items:[{eventId:'a',channel:'power',time:1000,value:7},{eventId:'b',channel:'power',time:3000,value:9}],continuity:[{from:1000,until:3000}]}; },
        async seed() { return {time:0,since:0,values:{temperature:10}}; }
    };
    it('reads the supplied raw store while preserving PostgreSQL context and revision fencing', async function() {
        const result=await historyContext(pool,'machine',1000,2000,{padding:1000,cutoff:-Infinity,observations:source});
        assert.equal(result.available,true);
        assert.deepEqual(result.items.map(({time,value})=>{return {time,value};}),[{time:1000,value:7},{time:3000,value:9}]);
        assert.deepEqual(result.initial.values,{temperature:10});
        assert.deepEqual(result.page,{from:0,until:3000,next:null,end:3000});
        assert.equal(typeof result.revision,'string');
        const changed={...source,async read(){return {items:[{eventId:'a',channel:'power',time:1000,value:8}],continuity:[{from:1000,until:1000}]};}};
        const next=await historyContext(pool,'machine',1000,2000,{padding:1000,cutoff:-Infinity,observations:changed});
        assert.notEqual(next.revision,result.revision);
    });
});
