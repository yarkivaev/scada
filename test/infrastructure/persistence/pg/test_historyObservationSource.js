import assert from 'node:assert/strict';
import historyContext from '../../../../src/infrastructure/persistence/pg/historyContext.js';
import * as scada from '../../../../index.js';

// The external backend owns raw observations; PostgreSQL owns only domain state.
describe('historical context with external observations', function() {
    const pool = {async query(sql) {
        if (/history_observations/u.test(sql)) { throw new Error('Raw observation table must not be read for external history'); }
        if (/AS open_ms/u.test(sql)) { return {rows:[{open_ms:30000}],rowCount:1}; }
        if (/FROM segments|FROM history_annotations|FROM history_admissions/u.test(sql)) { return {rows:[],rowCount:0}; }
        throw new Error(`Unexpected domain-state query: ${sql}`);
    }};
    const source = {
        async boundary() { return 3000; },
        async page() { return {from:0,until:3000,next:null,end:3000}; },
        async read() { return {items:[{eventId:'a',channel:'power',time:1000,value:7},{eventId:'b',channel:'power',time:3000,value:9}],continuity:[{from:1000,until:3000}]}; },
        async seed() { return {time:0,since:0,values:{temperature:10}}; }
    };
    it('reads the supplied raw store while preserving PostgreSQL context and revision fencing', async function() {
        const result=await scada.historyPg(pool,{observations:()=>{return source;},now:()=>{return 0;}}).context('machine',1000,2000,1000);
        assert.equal(result.available,true);
        assert.deepEqual(result.items.map(({time,value})=>{return {time,value};}),[{time:1000,value:7},{time:3000,value:9}]);
        assert.deepEqual(result.initial.values,{temperature:10});
        assert.deepEqual(result.page,{from:0,until:3000,next:null,end:3000});
        assert.equal(typeof result.revision,'string');
        const changed={...source,async read(){return {items:[{eventId:'a',channel:'power',time:1000,value:8}],continuity:[{from:1000,until:1000}]};}};
        const next=await historyContext(pool,'machine',1000,2000,{padding:1000,cutoff:-Infinity,observations:changed});
        assert.notEqual(next.revision,result.revision);
    });
    it('exports the supported staged history protocol for runtime capability checks',function(){assert.equal(scada.historyProtocol,'stateful-correction-v1');});
    it('does not advertise a stateful classifier protocol on the legacy PostgreSQL observation path', async function() {
        await assert.rejects(async()=>{await scada.historyPg(pool).configure('machine',[{topic:'a',channel:'power'}],30000,'casting');},/stateful|external/u);
    });
    it('does not conflict a classifier claim while a telemetry admission is still open', async function() {
        const connection={
            async query(sql) {
                if (sql==='BEGIN'||sql.startsWith('SELECT pg_advisory')||sql==='COMMIT'||sql==='ROLLBACK') { return {rows:[],rowCount:0}; }
                if (sql.includes('FROM history_admissions')) { return {rowCount:1,rows:[{}]}; }
                if (sql.includes('FROM history_work')) { return {rowCount:1,rows:[{id:'w1',token:'t1',from_ms:1000,until_ms:2000,cursor_ms:null,end_ms:null}]}; }
                throw new Error(`Unexpected domain-state query: ${sql}`);
            },
            release() {}
        };
        const db={async connect(){return connection;},async query(...args){return connection.query(...args);}};
        const store=scada.historyPg(db,{observations:()=>{return {};},now:()=>{return 0;}});
        const snapshot=await store.context('см-α',1000,2000,0,{classifierKey:'casting',workId:'w1',workToken:'t1'});
        const result=await store.commit('см-α','w1',[],{from:1000,until:2000,workToken:'t1'});
        assert.equal(snapshot.available===false && result.applied===false,true,'an open telemetry admission still conflicted a classifier claim');
    });
    it('does not offer the still-open external bucket to HistoryRun', async function() {
        const statements = [];
        const work = {
            async query(sql) {
                statements.push(sql);
                if (sql.includes('history_admissions')) { return { rowCount: 0, rows: [] }; }
                if (sql.includes('open_ms')) { return { rows: [{ open_ms: 1700000010000000 }] }; }
                return { rows: [] };
            }
        };
        await scada.historyPg(work, {
            retentionDays: 30, now: () => { return 1700000015000; }, timeScale: 1000,
            observations: () => { return {}; }
        }).work('см-α');
        assert.match(statements.join('\n'), /until_ms < \$2/u, 'external work still offered the live bucket');
        assert.match(statements.join('\n'), /clock_timestamp\(\)\) \* 1000 \* \$2/u,
            'external fence still used millisecond wall time against microsecond work');
    });
    it('does not claim the hottest closed bucket before older classifier pages', async function() {
        const statements = [];
        const work = {
            async query(sql) {
                statements.push(sql);
                if (sql.includes('history_admissions')) { return { rowCount: 0, rows: [] }; }
                if (sql.includes('open_ms')) { return { rows: [{ open_ms: 1700000040000000 }] }; }
                return { rows: [] };
            }
        };
        await scada.historyPg(work, {
            retentionDays: 30, now: () => { return 1700000045000; }, timeScale: 1000,
            observations: () => { return {}; }
        }).work('см-α');
        assert.match(statements.join('\n'), /until_ms < \$2[\s\S]*ORDER BY until_ms ASC/u,
            'work still claimed newest closed pages first');
    });
    it('does not offer the just-closed furnace bucket that can still receive observations', async function() {
        const statements = [];
        const work = {
            async query(sql) {
                statements.push(sql);
                if (sql.includes('history_admissions')) { return { rowCount: 0, rows: [] }; }
                if (sql.includes('open_ms')) { return { rows: [{ open_ms: 1700000040000000 }] }; }
                return { rows: [] };
            }
        };
        await scada.historyPg(work, {
            retentionDays: 30, now: () => { return 1700000045000; }, timeScale: 1000,
            observations: () => { return {}; }
        }).work('см-α');
        assert.match(statements.join('\n'), /until_ms < \$2 - /u,
            'work still offered the just-closed bucket');
    });
});
