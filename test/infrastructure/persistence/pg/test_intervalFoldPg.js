import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {GenericContainer,Wait} from 'testcontainers';
import ciContainerImage from '../../../helpers/ciContainerImage.js';
import intervalFold from '../../../../src/domain/segment/intervalFold.js';
import intervalFoldPg from '../../../../src/infrastructure/persistence/pg/intervalFoldPg.js';

async function database(action) {
    const container = await new GenericContainer(ciContainerImage('postgres','16-alpine')).withExposedPorts(5432)
        .withEnvironment({POSTGRES_PASSWORD:'test',POSTGRES_DB:'test'})
        .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections',2)).start();
    const pool = new pg.Pool({host:container.getHost(),port:container.getMappedPort(5432),user:'postgres',password:'test',database:'test'});
    try {
        await pool.query(await readFile(new URL('../../../../db/migrations/V0001__baseline.sql',import.meta.url),'utf8'));
        return await action(pool,intervalFoldPg(pool));
    } finally {await pool.end();await container.stop();}
}
function sequence(fold, samples) {
    return samples.reduce(async (prior,[value,ts]) => {await prior;await fold.accept({machine:'line',kind:'signal',value,ts});},Promise.resolve());
}
async function rows(pool) {
    return (await pool.query('SELECT name,start_time,end_time,duration FROM segments ORDER BY start_time')).rows
        .map(row=>{return [row.name,row.start_time.getTime(),row.end_time.getTime(),row.duration]});
}

describe('PostgreSQL interval fold replay',function() {
    this.timeout(90000);
    it('cannot poison a redelivered batch after its intervals were closed',async () => {
        const result=await database(async (pool,port) => {
            const fold=intervalFold(port);
            const samples=[[0,1700000000000],[1,1700000001000],[0,1700000002000]];
            await sequence(fold,samples);
            const before=await rows(pool);
            await sequence(fold,samples);
            return {before,after:await rows(pool)};
        });
        assert.deepEqual(result.after,result.before,'Redelivery changed or rejected an already folded interval');
    });
    it('cannot move an interval end backwards on an older heartbeat',async () => {
        const result=await database(async (pool,port) => {
            await sequence(intervalFold(port),[[0,1700000000000],[0,1700000002000],[0,1700000001000]]);
            return rows(pool);
        });
        assert.deepEqual(result,[['0',1700000000000,1700000002000,0]],'An older heartbeat shortened the open interval');
    });
    it('cannot duplicate a start when different values share its timestamp',async () => {
        const result=await database(async (pool,port) => {
            await sequence(intervalFold(port),[[0,1700000000000],[1,1700000000000],[1,1700000001000]]);
            return rows(pool);
        });
        assert.deepEqual(result,[['0',1700000000000,1700000001000,1],['1',1700000001000,1700000001000,0]],'A timestamp tie blocked the next genuine state change');
    });
    it('resumes a state change whose previous interval was already closed',async () => {
        const result=await database(async (pool,port) => {
            await sequence(intervalFold(port),[[0,1700000000000]]);
            await port.finish(await port.open('line','signal'),1700000001000);
            await sequence(intervalFold(intervalFoldPg(pool)),[[1,1700000001000]]);
            return rows(pool);
        });
        assert.deepEqual(result,[['0',1700000000000,1700000001000,1],['1',1700000001000,1700000001000,0]],'Recovery dropped the state at a closed interval boundary');
    });
    it('cannot reject concurrent copies of the same interval start',async () => {
        const result=await database(async (pool,port) => {
            const sample={machine:'line',kind:'signal',name:'1',ts:1700000000000};
            await Promise.all([port.begin(sample),intervalFoldPg(pool).begin(sample)]);
            return rows(pool);
        });
        assert.deepEqual(result,[['1',1700000000000,1700000000000,0]],'Concurrent redelivery inserted or rejected a duplicate interval');
    });
});
