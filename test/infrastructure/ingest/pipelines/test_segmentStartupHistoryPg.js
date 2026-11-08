import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import stompit from 'stompit';
import {GenericContainer,Wait} from 'testcontainers';
import ciContainerImage from '../../../helpers/ciContainerImage.js';
import segmentPipeline from '../../../../src/infrastructure/ingest/pipelines/segmentPipeline.js';
import {readDeploymentConfig} from '../../../../src/application/supervisorSink.js';

describe('PostgreSQL startup history policy',function() {
    this.timeout(120000);
    let container;
    let connection;
    let original;
    let receive;
    let acknowledged;
    const pool=()=>{return new pg.Pool({...connection,max:1});};
    const history=async db=>{return (await db.query("SELECT row_to_json(s) row FROM segments s WHERE machine='line-a' ORDER BY start_time")).rows.map(row=>{return row.row;});};
    before(async()=>{
        container=await new GenericContainer(ciContainerImage('postgres','16-alpine')).withLabels({'scada.test.feature':'edge-history-policy'}).withExposedPorts(5432)
            .withEnvironment({POSTGRES_PASSWORD:'test',POSTGRES_DB:'test'})
            .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections',2)).start();
        connection={host:container.getHost(),port:container.getMappedPort(5432),user:'postgres',password:'test',database:'test'};
        const db=pool();
        try {
            await db.query(await readFile(new URL('../../../../db/migrations/V0001__baseline.sql',import.meta.url),'utf8'));
            await db.query(await readFile(new URL('../../../../db/migrations/V0008__segments_updated_at.sql',import.meta.url),'utf8'));
        } finally {await db.end();}
    });
    beforeEach(async()=>{
        original=stompit.Channel;acknowledged=0;
        stompit.Channel=function Channel(){return {subscribe(_headers,callback){receive=callback;},ack(){acknowledged+=1;},nack(){},close(){}};};
        const db=pool();
        try {
            await db.query('TRUNCATE segments');
            await db.query(`INSERT INTO segments(machine,kind,name,start_time,end_time,duration,tags,properties,updated_at) VALUES
                ('line-a','signal','on','2026-10-01T00:00:00.000001Z','2026-10-01T00:00:10.000001Z',10,'["reason-a"]','{"marked":true}','2026-10-01T01:00:00Z'),
                ('line-a','signal','on','2026-10-01T00:00:15.000001Z','2026-10-01T00:00:20.000001Z',5,'["reason-b"]','{}','2026-10-01T01:00:00Z')`);
        } finally {await db.end();}
    });
    afterEach(()=>{stompit.Channel=original;});
    after(async()=>{await container?.stop();});
    it('preserves every closed field and label across repeated startup when history repair is disabled',async()=>{
        const initial=pool();let before;try{before=await history(initial);}finally{await initial.end();}
        async function startup() {
            const db=pool();
            const config=readDeploymentConfig({SEGMENT_REPAIR_HISTORY_ON_START:'false'}).pipeline;
            const pipeline=segmentPipeline('stomp://fixture','postgres://fixture',db,config);
            try {await pipeline.start();return await history(db);}
            finally {await pipeline.stop();}
        }
        assert.deepEqual(await startup(),before,'First startup rewrote closed history');
        assert.deepEqual(await startup(),before,'Repeated startup rewrote closed history');
    });
    it('retains the existing gap repair when the policy is omitted',async()=>{
        const db=pool();const pipeline=segmentPipeline('stomp://fixture','postgres://fixture',db,{});
        try {
            await pipeline.start();const rows=await history(db);
            assert.equal(rows[0].end_time,rows[1].start_time);
            assert.equal(rows[0].duration,15);
            assert.equal(rows[0].tags,'["reason-a"]');
            assert.equal(rows[1].tags,'["reason-b"]');
        } finally {await pipeline.stop();}
    });
    it('still commits and acknowledges a new segment with history repair disabled',async()=>{
        const db=pool();const config={...readDeploymentConfig({SEGMENT_REPAIR_HISTORY_ON_START:'false'}).pipeline,size:1,interval:.01};
        const pipeline=segmentPipeline('stomp://fixture','postgres://fixture',db,config);
        try {
            await pipeline.start();const payload=JSON.stringify({type:'segment',machine:'line-live',kind:'phase',name:'on',start:1700000000000,end:1700000001000,duration:1});
            receive(null,{readString(_encoding,done){done(null,payload);}});
            for(let attempt=0;attempt<100;attempt+=1){
                if(acknowledged) {break;}
                // Poll the asynchronous protocol ACK with a finite deadline.
                // eslint-disable-next-line no-await-in-loop
                await delay(10);
            }
            assert.equal(acknowledged,1,'New durable segment was not acknowledged');
            const result=await db.query("SELECT duration FROM segments WHERE machine='line-live'");
            assert.equal(result.rows[0]?.duration,1);
        } finally {await pipeline.stop();}
    });
});
