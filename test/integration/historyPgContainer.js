import assert from 'node:assert/strict';
import pg from 'pg';
import { GenericContainer } from 'testcontainers';
import { readFile } from 'node:fs/promises';
import historyPg from '../../src/infrastructure/persistence/pg/history.js';

describe('Historical telemetry PostgreSQL', function historyTests() {
    this.timeout(120000);
    let container;
    let pool;
    before(async () => {
        container = await new GenericContainer('postgres:16-alpine').withEnvironment({ POSTGRES_PASSWORD: 'test' }).withExposedPorts(5432).start();
        pool = new pg.Pool({ host: container.getHost(), port: container.getMappedPort(5432), user: 'postgres', password: 'test' });
        for (let attempt = 0; attempt < 30; attempt += 1) {
            // eslint-disable-next-line no-await-in-loop
            try { await pool.query('SELECT 1'); break; } catch { await new Promise((resolve) => { setTimeout(resolve, 300); }); }
        }
        await pool.query(await readFile(new URL('../../db/migrations/V0001__baseline.sql', import.meta.url), 'utf8'));
        await pool.query(await readFile(new URL('../../db/migrations/V0010__historical_telemetry.sql', import.meta.url), 'utf8'));
    });
    after(async () => { await pool?.end(); await container?.stop(); });
    it('atomically accepts first value, ignores conflicts and records persistent work', async () => {
        const store = historyPg(pool);
        const time = Date.now() - 10000;
        await store.accept('m1', [{ eventId: 'a', channel: 'power', time, value: 1 }]);
        await store.accept('m1', [{ eventId: 'b', channel: 'power', time, value: 2 }]);
        const context = await store.context('m1', time, time);
        assert.equal(context.items.length, 1); assert.equal(context.items[0].value, 1);
        const work = await store.work('m1'); assert.equal(work.items.length, 1);
        await store.commit('m1', work.items[0].id, []);
        assert.equal((await store.work('m1')).items.length, 0);
        await store.commit('m1', work.items[0].id, []);
    });
    it('does not schedule classification for out-of-history telemetry', async () => {
        const store = historyPg(pool);
        const time = Date.now() - 31 * 86400000;
        await store.accept('m2', [{ eventId: 'old', channel: 'power', time, value: 1 }]);
        assert.equal((await store.context('m2', time, time)).available, false);
        assert.equal((await store.work('m2')).items.length, 0);
    });
    it('keeps work pending when an operator changes the context during classification', async () => {
        const store = historyPg(pool);
        const time = Date.now() - 2000;
        await pool.query("INSERT INTO segments(machine,kind,name,start_time,end_time,duration) VALUES('race','phase','off',$1,$2,1)", [new Date(time), new Date(time+1000)]);
        await store.accept('race', [{eventId:'race',channel:'power',time,value:0}]);
        const context = await store.context('race',time,time+1000);
        const work = (await store.work('race')).items[0];
        await pool.query("UPDATE segments SET tags='[\"manual\"]' WHERE machine='race'");
        await assert.rejects(store.commit('race',work.id,context.segments,{...context.context,revision:context.revision}), /context changed/u);
        assert.equal((await store.work('race')).items.length,1);
        assert.equal((await pool.query("SELECT tags FROM segments WHERE machine='race'")).rows[0].tags,'["manual"]');
    });

});
