import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import amqp from 'amqplib';
import pg from 'pg';
import { GenericContainer, Wait } from 'testcontainers';
import { createEdgeApi } from '../../src/infrastructure/http/edge/edgeApi.js';
import historyReplicaRelay from '../../src/application/historyReplicaRelay.js';
import { deliverHistoryReplica, enableHistoryReplicaCapture } from '../../src/infrastructure/persistence/pg/historyReplicaOutbox.js';
import historyPg from '../../src/infrastructure/persistence/pg/history.js';
import amqpSink from '../../src/infrastructure/streams/amqpSink.js';
import { decodeSegmentBody } from '../../src/infrastructure/ingest/codecs/segmentCodec.js';
import { serialSegmentTransaction } from '../../src/infrastructure/persistence/pg/segmentWriteFence.js';
import { segmentRecipient } from '../../src/infrastructure/ingest/pipelines/segmentPipeline.js';

describe('historical replication outbox', function () {
    this.timeout(120000);
    let brokerUrl;
    let channel;
    let connection;
    let dbUrl;
    let pool;
    let postgres;
    let rabbit;
    let relay;
    let replicaPool;

    async function migrate(connectionPool) {
        for (const file of [
            'V0001__baseline.sql', 'V0008__segments_updated_at.sql', 'V0013__contiguous_phase_inbox.sql',
            'V0015__segment_write_receipts.sql', 'E0001__edge_metrics.sql', 'E0006__historical_telemetry.sql',
            'E0009__history_continuation.sql', 'E0019__segment_write_fence.sql', 'E0021__history_replica_outbox.sql',
            'V0016__timeline_replica_positions.sql', 'E0023__timeline_replica_changes.sql'
        ]) {
            // eslint-disable-next-line no-await-in-loop
            await connectionPool.query(await readFile(new URL(`../../db/migrations/${file}`, import.meta.url), 'utf8'));
        }
    }

    before(async function () {
        postgres = await new GenericContainer('postgres:16-alpine')
            .withEnvironment({ POSTGRES_PASSWORD: 'test' }).withExposedPorts(5432)
            .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2)).start();
        dbUrl = `postgresql://postgres:test@${postgres.getHost()}:${postgres.getMappedPort(5432)}/postgres`;
        pool = new pg.Pool({ connectionString: dbUrl });
        await pool.query('CREATE DATABASE replica');
        replicaPool = new pg.Pool({ connectionString: dbUrl.replace(/postgres$/u, 'replica') });
        await Promise.all([migrate(pool), migrate(replicaPool)]);
        rabbit = await new GenericContainer('rabbitmq:3.13-alpine').withExposedPorts(5672)
            .withWaitStrategy(Wait.forLogMessage(/Server startup complete/u)).start();
        brokerUrl = `amqp://guest:guest@${rabbit.getHost()}:${rabbit.getMappedPort(5672)}`;
        connection = await amqp.connect(brokerUrl);
        channel = await connection.createChannel();
        await channel.assertExchange('scada.segments', 'topic', { durable: true });
        await channel.assertQueue('history-replica', { durable: true });
        await channel.bindQueue('history-replica', 'scada.segments', '#');
        relay = amqpSink(brokerUrl);
        await relay.start();
    });
    after(async function () {
        await relay?.stop();
        await connection?.close();
        await pool?.end();
        await replicaPool?.end();
        await rabbit?.stop();
        await postgres?.stop();
    });

    async function correction(exchange = 'scada.segments') {
        const machine = randomUUID(); const token = randomUUID(); const id = randomUUID();
        const time = Date.now() - 100000;
        const item = { name: 'heat', start_time: new Date(time), end_time: new Date(time + 3000), duration: 3 };
        await pool.query('INSERT INTO history_work(id,machine,token,from_ms,until_ms) VALUES($1,$2,$3,$4,$5)',
            [id, machine, token, time, time + 3000]);
        const snapshot = await historyPg(pool).context(machine, time, time + 3000, 0);
        const claim = { ...snapshot.context, workToken: token, revision: snapshot.revision,
            fence: { outputId: 'historical-correction' }, replication: { exchange, routingKey: '' } };
        return [machine, id, [item], claim];
    }

    function crash(code, args = []) {
        const child = spawn(process.execPath, ['--input-type=module', '-e', code, ...args], {
            env: { ...process.env, HISTORY_TEST_DB: dbUrl, HISTORY_TEST_BROKER: brokerUrl }, stdio: 'inherit'
        });
        return once(child, 'exit');
    }

    function publish(record) { return relay.write([record]); }

    it('recovers after the writer dies immediately after COMMIT and deduplicates a confirmed retry', async function () {
        const args = await correction();
        assert.deepEqual(await crash(`
            import pg from 'pg';
            import historyPg from './src/infrastructure/persistence/pg/history.js';
            const pool = new pg.Pool({ connectionString: process.env.HISTORY_TEST_DB });
            const result = await historyPg(pool).commit(...JSON.parse(process.argv[1]));
            if (!result.applied) process.exit(1);
            process.kill(process.pid, 'SIGKILL');
        `, [JSON.stringify(args)]), [null, 'SIGKILL']);
        assert.deepEqual(await historyPg(pool).commit(...args), { applied: true });

        assert.deepEqual(await crash(`
            import pg from 'pg';
            import amqpSink from './src/infrastructure/streams/amqpSink.js';
            import { deliverHistoryReplica } from './src/infrastructure/persistence/pg/historyReplicaOutbox.js';
            const pool = new pg.Pool({ connectionString: process.env.HISTORY_TEST_DB });
            const publisher = amqpSink(process.env.HISTORY_TEST_BROKER);
            await publisher.start();
            await deliverHistoryReplica(pool, async record => {
                await publisher.write([record]);
                process.kill(process.pid, 'SIGKILL');
            });
        `), [null, 'SIGKILL']);
        assert.equal((await deliverHistoryReplica(pool, publish)).found, true);
        assert.equal((await deliverHistoryReplica(pool, publish)).found, false);

        const first = await channel.get('history-replica', { noAck: true });
        const second = await channel.get('history-replica', { noAck: true });
        assert(first && second);
        assert.deepEqual(first.content, second.content);
        assert.equal(first.properties.deliveryMode, 2);
        assert.equal(await channel.get('history-replica', { noAck: true }), false);
        const body = JSON.parse(first.content);
        const replica = segmentRecipient(dbUrl.replace(/postgres$/u, 'replica'), replicaPool, { acceptReplicaSegments: true });
        const applied = await replica.dispatch.accept(decodeSegmentBody(body));
        await replicaPool.query("UPDATE segments SET tags='[\"operator\"]' WHERE machine=$1", [body.machine]);
        const afterEdit = await replica.live.revision(body.machine);
        const duplicate = await replica.dispatch.accept(decodeSegmentBody(JSON.parse(second.content)));
        assert.equal(applied.applied, true);
        assert.deepEqual(duplicate, applied);
        assert.deepEqual(await replica.live.revision(body.machine), afterEdit);
    });

    async function timeline(database, machine) {
        const {rows} = await database.query(`SELECT kind,name,start_time,end_time,duration,tags,properties,options,resolved,consumed
            FROM segments WHERE machine=$1 ORDER BY start_time,kind`,[machine]);
        return rows;
    }

    async function drain() {
        const frames = [];
        for (;;) {
            // eslint-disable-next-line no-await-in-loop
            const result = await deliverHistoryReplica(pool, publish);
            if (result.error) { throw result.error; }
            if (!result.found) { return frames; }
            // eslint-disable-next-line no-await-in-loop
            const frame = await channel.get('history-replica', { noAck: true });
            frames.push(JSON.parse(frame.content));
        }
    }

    async function converges(withLive) {
        const machine = randomUUID();
        const start = Date.now() - 100000;
        const middle = start + 1000;
        const end = start + 9000;
        const workId = randomUUID();
        const token = randomUUID();
        const replication = { exchange: 'scada.segments', routingKey: '', protocol: 'transactional-history-outbox-v2' };
        const authority = segmentRecipient(dbUrl, pool, {});
        const replica = segmentRecipient(dbUrl, replicaPool, { acceptReplicaSegments: true });
        const live = async (id, name, from, to) => {
            const {revision} = await authority.live.revision(machine);
            return authority.live.applyOutbox({
                machine, type: 'segment', name, start: from, end: to, duration: (to - from) / 1000,
                tags: [], options: [], properties: {}, fence: { outputId: id, revision }
            }, replication);
        };
        const receive = frame => { return replica.dispatch.accept(decodeSegmentBody(frame)); };
        const seed = client => {
            return client.query(`INSERT INTO segments(machine,kind,name,start_time,end_time,duration,tags,properties,options)
                VALUES($1,'phase','on',$2,$3,1,'[]','{}','[]'),($1,'phase','on',$3,$4,8,'[]','{}','[]')`,
            [machine,new Date(start),new Date(middle),new Date(end)]);
        };
        await serialSegmentTransaction(pool,machine,async client => {
            await enableHistoryReplicaCapture(client,machine,{outputId:'seed-before-upgrade'},replication);
            await seed(client);
        });
        await seed(replicaPool);
        const initial = await drain();
        assert.equal(initial.length,2);
        await pool.query('INSERT INTO history_work(id,machine,token,from_ms,until_ms) VALUES($1,$2,$3,$4,$5)',
            [workId, machine, token, end, end]);
        const store = historyPg(pool);
        const context = await store.context(machine, end, end, 0);
        const row = { name: 'on', start_time: new Date(start), end_time: new Date(end), duration: 9,
            tags: [], options: [], properties: {} };
        await store.commit(machine, workId, [row], { ...context.context, revision: context.revision,
            workToken: token, fence: { outputId: 'correction-with-delete' }, replication });
        const correctionFrames = await drain();
        assert(correctionFrames.some(frame => { return frame.type === 'segment-delete'; }));
        if (withLive) {
            await live('later-live', 'off', middle, end + 4000);
            const later = await drain();
            assert(later.some(frame => { return frame.start === middle; }));
            for (const frame of later) {
                // eslint-disable-next-line no-await-in-loop
                await receive(frame);
            }
        }
        for (const frame of [...correctionFrames, ...initial, ...correctionFrames]) {
            // eslint-disable-next-line no-await-in-loop
            await receive(frame);
        }
        assert.deepEqual(await timeline(replicaPool, machine), await timeline(pool, machine));
    }

    it('converges after a deletion and reordered redelivery', async () => { await converges(false); });
    it('keeps a later live write when the historical deletion is delivered afterwards', async () => { await converges(true); });


    it('keeps an unroutable publication pending until RabbitMQ has a binding', async function () {
        const exchange = 'recovered.history';
        await channel.assertExchange(exchange, 'topic', { durable: true });
        assert.deepEqual(await historyPg(pool).commit(...await correction(exchange)), { applied: true });
        assert.equal((await deliverHistoryReplica(pool, publish, 0)).error?.code, 'AMQP_UNROUTABLE');
        await channel.bindQueue('history-replica', exchange, '#');
        assert.equal((await deliverHistoryReplica(pool, publish)).found, true);
        assert(await channel.get('history-replica', { noAck: true }));
    });

    it('accepts the replicated commit only on a configured receiver and uses the relay on startup', async function () {
        const worker = historyReplicaRelay(brokerUrl, pool);
        const [machine, workId, segments, { replication, ...context }] = await correction();
        const api = createEdgeApi({
            history: worker.history(historyPg(pool)),
            liveSegments: segmentRecipient(dbUrl,pool,{}).live
        }, { token: 'outbox-test', metricsEnabled: false });
        const server = createServer((req, res) => { return api.handle(req, res); });
        await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve); });
        const base = `http://127.0.0.1:${server.address().port}/v1/history`;
        const request = { method: 'POST', headers: { authorization: 'Bearer outbox-test', 'content-type': 'application/json' } };
        try {
            const invalid = await fetch(`${base}/commit`, { ...request, body: JSON.stringify({ machine, workId, segments, context: { ...context, replication } }) });
            assert.equal(invalid.status, 400);
            const { revision } = await segmentRecipient(dbUrl,pool,{}).live.revision(machine);
            const live = await fetch(`${base}/live-apply-outbox`, { ...request, body: JSON.stringify({
                machine, type:'segment', name:'live', start:segments[0].start_time.getTime(),
                end:segments[0].end_time.getTime(), duration:3,
                fence:{outputId:'live-while-history-cas',revision}, replication
            }) });
            assert.equal(live.status,200);
            assert.deepEqual((await live.json()).applied,true);
            const conflict = await fetch(`${base}/commit-outbox-v2`, { ...request, body: JSON.stringify({ machine, workId, segments, context, replication }) });
            assert.equal(conflict.status,409);
            const current = await historyPg(pool).context(machine,context.from,context.until,0);
            const accepted = await fetch(`${base}/commit-outbox-v2`, { ...request, body: JSON.stringify({ machine, workId, segments, context:{...context,revision:current.revision}, replication }) });
            assert.deepEqual(await accepted.json(), { applied: true });
            assert.equal(await channel.get('history-replica', { noAck: true }), false);

            const received = new Promise(resolve => { void channel.consume('history-replica', resolve, { noAck: true }); });
            worker.start();
            const delivery = await received;
            const body = JSON.parse(delivery.content);
            assert.equal(body.machine, machine);
            assert(body.timelineChange?.origin);
            assert.equal(body.committedOutputId.startsWith('history:'),true);
            await channel.cancel(delivery.fields.consumerTag);
        } finally {
            await worker.stop();
            await new Promise(resolve => { server.close(resolve); });
        }
    });
});
