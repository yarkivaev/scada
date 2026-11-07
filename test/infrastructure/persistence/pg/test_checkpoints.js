import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {GenericContainer,Wait} from 'testcontainers';
import image from '../../../helpers/ciContainerImage.js';
import rows from '../../../helpers/checkpointRows.js';
import checkpoints from '../../../../src/infrastructure/persistence/pg/checkpoints.js';

/** Runs checkpoint queries against real independent PostgreSQL state and closes every resource. */
async function database(action) {
    const container=await new GenericContainer(image('postgres','16-alpine')).withExposedPorts(5432)
        .withEnvironment({POSTGRES_PASSWORD:'fixture',POSTGRES_DB:'fixture'})
        .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections',2)).start();
    const pool=new pg.Pool({host:container.getHost(),port:container.getMappedPort(5432),user:'postgres',password:'fixture',database:'fixture'});
    try {
        const machine=`line-${Math.random()}`;
        await pool.query(await readFile(new URL('../../../../db/migrations/V0001__baseline.sql',import.meta.url),'utf8'));
        await Promise.all(rows(machine).map((row) => {
            return pool.query('INSERT INTO segments (machine,kind,name,start_time,end_time,duration,tags,options,properties) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',Object.values(row));
        }));
        return await action(checkpoints(pool,true),machine);
    } finally {await pool.end();await container.stop();}
}
describe('PostgreSQL checkpoint phase isolation',function() {
    this.timeout(90000);
    it('cannot restore metric intervals as pending phases',async function() {
        const names=await database(async port=>{return (await port.pendingSegments()).map(row=>{return row.name})});
        assert.deepEqual(names,['running'],'Metric intervals escaped into pending recovery');
    });
    it('cannot move a phase replay cursor using metric boundaries',async function() {
        const cursor=await database((port,machine)=>{return port.replayCursor(machine)});
        assert.equal(cursor,2,'Metric boundaries moved the phase replay cursor');
    });
    it('cannot select a metric sharing the phase start',async function() {
        const row=await database((port,machine)=>{return port.segment(machine,3)});
        assert.equal(row.name,'running','A metric shadowed the phase at the same timestamp');
    });
    it('cannot let metric reset tags truncate phase history',async function() {
        const names=await database(async (port,machine)=>{return (await port.cyclePrior(machine,9,['reset'])).map(row=>{return row.name})});
        assert.deepEqual(names,['idle','running'],'Metric reset tags contaminated phase history');
    });
});
