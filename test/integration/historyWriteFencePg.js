import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { GenericContainer } from 'testcontainers';
import pg from 'pg';
import { decodeSegmentBody } from '../../src/infrastructure/ingest/codecs/segmentCodec.js';
import { createEdgeApi } from '../../src/infrastructure/http/edge/edgeApi.js';
import historyPg from '../../src/infrastructure/persistence/pg/history.js';
import { segmentRecipient } from '../../src/infrastructure/ingest/pipelines/segmentPipeline.js';

describe('fenced segment recipient on Postgres', function() {
    this.timeout(120000);
    let container;
    let pool;
    let url;
    before(async function() {
        const configured = process.env.SCADA_WRITE_FENCE_TEST_DATABASE_URL;
        if (!configured) {
            container = await new GenericContainer('postgres:16-alpine')
                .withEnvironment({POSTGRES_PASSWORD:'test'}).withExposedPorts(5432).start();
        }
        url = configured ?? `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/postgres`;
        pool = new pg.Pool({ connectionString: url });
        if (container) {
            const migrations = [
                'V0001__baseline.sql','V0008__segments_updated_at.sql','V0013__contiguous_phase_inbox.sql',
                'V0015__segment_write_receipts.sql','E0001__edge_metrics.sql','E0006__historical_telemetry.sql',
                'E0009__history_continuation.sql','E0019__segment_write_fence.sql'
            ];
            for (const file of migrations) {
                // eslint-disable-next-line no-await-in-loop
                await pool.query(await readFile(new URL(`../../db/migrations/${file}`,import.meta.url),'utf8'));
            }
        }
    });
    after(async function() { await pool?.end(); await container?.stop(); });

    it('checks a real lease and revision, and returns committed receipts after operator edits', async function() {
        const machine = randomUUID();
        const recipient = segmentRecipient(url, pool, {});
        const owner = await pool.connect();
        try {
            await owner.query("SELECT pg_advisory_lock(hashtext('scada-classify'),hashtext($1))", [machine]);
            await owner.query('INSERT INTO classifier_generation(machine,generation,holder_pid) VALUES($1,8,pg_backend_pid())', [machine]);
            const first = { machine, type: 'segment', name: 'running', start: 1000, end: 2000, duration: 1, tags: ['original'] };
            const {revision} = await recipient.live.revision(machine);
            const fence = { outputId: 'output-1', generation: 8, revision };
            const replica = segmentRecipient(url,pool,{acceptReplicaSegments:true});
            assert.deepEqual(await replica.dispatch.accept(decodeSegmentBody({...first,committedOutputId:'output-1'})),
                {applied:false});
            await assert.rejects(recipient.live.apply({...first, fence:{...fence, generation: 7}}), {writeCode:'STALE_OWNER'});
            await assert.rejects(recipient.live.apply({...first, fence:{...fence, generation: undefined}}), {writeCode:'STALE_OWNER'});
            const confirmed = await recipient.live.apply({...first, fence});
            assert.deepEqual(confirmed, {applied:true,...await recipient.live.revision(machine)});
            await pool.query('UPDATE segments SET tags=$2 WHERE machine=$1', [machine, '["operator"]']);
            assert.deepEqual(await recipient.live.apply({...first, fence}), confirmed);
            await assert.rejects(recipient.live.apply({...first, name:'other', fence}), {writeCode:'OUTPUT_CONFLICT'});
            await assert.rejects(recipient.live.apply({...first, fence:{...fence, outputId: 'output-2'}}), {writeCode:'REVISION_CONFLICT'});
            const {rows:[row]} = await pool.query('SELECT name,tags FROM segments WHERE machine=$1', [machine]);
            assert.deepEqual(row, {name:'running', tags:'["operator"]'});
        } finally {
            await owner.query('SELECT pg_advisory_unlock_all()');
            owner.release();
        }
        const {revision} = await recipient.live.revision(machine);
        const next = { machine, name:'idle', start:2000,end:3000,duration:1 };
        await assert.rejects(recipient.live.apply({...next, fence:{outputId:'output-2',generation:8,revision}}), {writeCode:'STALE_OWNER'});
        assert.deepEqual(await recipient.live.apply({...next, fence:{outputId:'output-2',revision}}),
            {applied:true,...await recipient.live.revision(machine)});
    });

    it('treats local and remote broker redelivery as the same durable outcome', async function() {
        const machine = randomUUID();
        const owner = segmentRecipient(url,pool,{});
        const recipient = segmentRecipient(url,pool,{acceptReplicaSegments:true});
        const command = { machine,type:'segment',name:'running',start:1000,end:2000,duration:1 };
        const relay = decodeSegmentBody({...command,committedOutputId:'replicated-output'});
        assert.deepEqual(await owner.dispatch.accept(relay),{applied:false});
        assert.deepEqual(await owner.live.revision(machine),{revision:'0'});
        const confirmed = await recipient.dispatch.accept(relay);
        assert.deepEqual(confirmed,{applied:true,...await recipient.live.revision(machine)});
        await pool.query('UPDATE segments SET tags=$2 WHERE machine=$1',[machine,'["operator"]']);
        const before = await recipient.live.revision(machine);
        assert.deepEqual(await recipient.dispatch.accept(relay),confirmed);
        assert.deepEqual(await owner.dispatch.accept(relay),confirmed);
        assert.deepEqual(await recipient.live.revision(machine),before);
        assert.deepEqual(await recipient.live.apply({...command,
            fence:{outputId:'replicated-output',revision:before.revision}}),confirmed);
    });

    it('retains operator metadata and clears processor-owned properties on anchored phases', async function() {
        const machine = randomUUID();
        const recipient = segmentRecipient(url, pool, {
            phaseAnchors: new Map([[machine,new Date(1000).toISOString()]]), processorProperties: ['processor_status']
        });
        const pending = {machine,type:'segment',name:'running',start:1000,end:2000,duration:0};
        const {revision:initial} = await recipient.live.revision(machine);
        await recipient.live.apply({...pending,properties:{phase_revision:'1',processor_status:'2'},
            fence:{outputId:'pending',revision:initial}});
        await pool.query('UPDATE segments SET tags=$2,properties=$3 WHERE machine=$1',
            [machine,'["operator"]','{"phase_revision":"1","note":"checked","processor_status":"2"}']);
        const {revision} = await recipient.live.revision(machine);
        await recipient.live.apply({...pending,end:2100,options:['stale-options'],properties:{phase_revision:'2',note:'stale'},
            fence:{outputId:'restored',revision}});
        const {rows:[row]} = await pool.query('SELECT tags,properties,options FROM segments WHERE machine=$1',[machine]);
        assert.deepEqual(JSON.parse(row.tags),['operator']);
        assert.deepEqual(JSON.parse(row.properties),{phase_revision:'2',note:'checked'});
        assert.equal(row.options,null);
    });

    it('keeps a history result after its work claim advances and rejects an operator race', async function() {
        const machine = randomUUID();
        const id = randomUUID();
        const token = randomUUID();
        const time = Date.now()-100000;
        const store = historyPg(pool);
        await pool.query('INSERT INTO history_work(id,machine,token,from_ms,until_ms) VALUES($1,$2,$3,$4,$5)',
            [id,machine,token,time,time+1000]);
        const first = await store.context(machine,time,time+1000,0);
        const item = {name:'running',start_time:new Date(time),end_time:new Date(time+1000),duration:1};
        const fence = {outputId:'history-output'};
        const claim = {...first.context,workToken:token,revision:first.revision,fence};
        await pool.query("INSERT INTO segments(machine,kind,name,start_time,end_time,duration,tags) VALUES($1,'phase','running',$2,$3,1,$4)",
            [machine,item.start_time,item.end_time,'["operator"]']);
        await assert.rejects(store.commit(machine,id,[item],claim),{writeCode:'REVISION_CONFLICT'});
        const current = await store.context(machine,time,time+1000,0);
        const verified = {...current.context,workToken:token,revision:current.revision,fence};
        assert.deepEqual(await store.commit(machine,id,[item],verified),{applied:true});
        assert.deepEqual(await store.commit(machine,id,[item],verified),{applied:true});
        const {rows:[row]} = await pool.query('SELECT tags FROM segments WHERE machine=$1',[machine]);
        assert.deepEqual(JSON.parse(row.tags),['operator']);
    });

    it('returns committed revisions through the authenticated HTTP endpoint', async function() {
        const {live:liveSegments} = segmentRecipient(url,pool,{});
        const api = createEdgeApi({liveSegments},{token:'fence-check',metricsEnabled:false});
        const server = createServer((req,res) => { return api.handle(req,res); });
        await new Promise(resolve => { server.listen(0,'127.0.0.1',resolve); });
        const base = `http://127.0.0.1:${server.address().port}/v1/history`;
        const headers = {Authorization:'Bearer fence-check','Content-Type':'application/json'};
        const machine = randomUUID();
        function submit(outputId, revision) {
            const body = {machine,type:'segment',name:'running',start:1000,end:2000,duration:1,
                fence:{outputId,revision}};
            return fetch(`${base}/live-apply`,{method:'POST',headers,body:JSON.stringify(body)});
        }
        try {
            const revisionPath = `${base}/live-revision?machine=${machine}`;
            assert.equal((await fetch(revisionPath)).status,403);
            const {revision} = await (await fetch(revisionPath,{headers})).json();
            const first = await submit('first',revision);
            assert.equal(first.status,200);
            const confirmed = await first.json();
            assert.notEqual(confirmed.revision,revision);
            const stale = await submit('second',revision);
            assert.equal(stale.status,409);
            assert.equal((await stale.json()).error.code,'REVISION_CONFLICT');
            const next = await submit('second',confirmed.revision);
            assert.equal(next.status,200);
            assert.equal((await next.json()).applied,true);
        } finally {
            await new Promise((resolve,reject) => {
                server.close(error => { if (error) { reject(error); } else { resolve(); } });
            });
        }
    });
});
