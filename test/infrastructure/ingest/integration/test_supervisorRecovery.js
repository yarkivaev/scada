/* eslint-disable no-await-in-loop -- Broker/database readiness and controller replacement are sequential fixtures. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { GenericContainer, Wait } from 'testcontainers';
import pg from 'pg';
import amqp from 'amqplib';

const entry = fileURLToPath(new URL('../../../../src/bin/supervisor-sink.js', import.meta.url));
async function until(probe, milliseconds = 30000) {
    const end = Date.now() + milliseconds;
    while (Date.now() < end) {
        if (await probe()) { return; }
        await delay(100);
    }
    throw new Error('Ingest recovery condition timed out');
}
async function freePort() {
    const server = net.createServer();
    await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    await new Promise(resolve => { server.close(resolve); });
    return port;
}
async function healthy(port) {
    try { return (await fetch(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(1000) })).status === 200; }
    catch { return false; }
}
function processFor(fixture) {
    const child = spawn(process.execPath, [entry], { env: { ...process.env,
        STOMP_URL: fixture.stompUrl, STOMP_LOGIN: 'streams', STOMP_PASSCODE: 'streams', STOMP_HOST: '/',
        POSTGRES_URL: fixture.pgUrl, POSTGRES_ADMIN_URL: fixture.pgUrl, SINK_DB_PROFILE: 'central',
        STATE_HTTP_PORT: String(fixture.port), SINK_PIPELINES: 'true', COLLECTOR_MODE: 'embedded',
        FLUSH_INTERVAL: '1', STOMP_ACCEPT_TIMEOUT_MS: '500', STOMP_PREFETCH: '128', RETENTION_ENABLED: 'false'
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    fixture.output = '';
    for (const stream of [child.stdout, child.stderr]) { stream.on('data', chunk => { fixture.output += chunk.toString(); }); }
    fixture.child = child;
    return child;
}
async function stopChild(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) { return; }
    const exited = new Promise(resolve => { child.once('exit', resolve); });
    child.kill('SIGTERM');await exited;
}
function message(index) {
    return Buffer.from(JSON.stringify({ type: 'segment', machine: 'integration-machine',
        name: index % 2 ? 'off' : 'on', start: 1700000000000 + index * 60000,
        end: 1700000060000 + index * 60000, duration: 60, tags: [] }));
}
async function count(pool) { return Number((await pool.query('SELECT count(*) FROM segments')).rows[0].count); }

describe('supervisor sink durable recovery integration', function() {
    this.timeout(180000);
    const fixture = {};
    before(async () => {
        [fixture.rabbit, fixture.postgres] = await Promise.all([
            new GenericContainer('rabbitmq:3.13-management').withEnvironment({ RABBITMQ_DEFAULT_USER: 'streams', RABBITMQ_DEFAULT_PASS: 'streams' })
                .withExposedPorts(5672, 61613, 15672).withCommand(['sh', '-c', 'rabbitmq-plugins enable --offline rabbitmq_stomp && rabbitmq-server'])
                .withWaitStrategy(Wait.forListeningPorts()).withStartupTimeout(90000).start(),
            new GenericContainer('postgres:16-alpine').withEnvironment({ POSTGRES_PASSWORD: 'streams', POSTGRES_DB: 'scada' })
                .withExposedPorts(5432).withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2)).start()
        ]);
        fixture.pgUrl = `postgres://postgres:streams@${fixture.postgres.getHost()}:${fixture.postgres.getMappedPort(5432)}/scada`;
        fixture.stompUrl = `stomp://${fixture.rabbit.getHost()}:${fixture.rabbit.getMappedPort(61613)}`;
        fixture.pool = new pg.Pool({ connectionString: fixture.pgUrl, connectionTimeoutMillis: 2000 });
        await fixture.pool.query('CREATE ROLE supervisor_sink');
        fixture.amqpUrl = `amqp://streams:streams@${fixture.rabbit.getHost()}:${fixture.rabbit.getMappedPort(5672)}`;
        fixture.managementUrl = `http://${fixture.rabbit.getHost()}:${fixture.rabbit.getMappedPort(15672)}`;
        Object.assign(fixture, { connection: await amqp.connect(fixture.amqpUrl) });
        Object.assign(fixture, { channel: await fixture.connection.createChannel() });
        for (const exchange of ['scada.segments', 'scada.user_decisions', 'scada.alerts']) {
            await fixture.channel.assertExchange(exchange, 'topic', { durable: true });
        }
        await fixture.channel.assertQueue('scada.segments.ingest', { durable: true });
        await fixture.channel.bindQueue('scada.segments.ingest', 'scada.segments', '#');
        Object.assign(fixture, { port: await freePort() });processFor(fixture);
        await until(() => {return healthy(fixture.port)}, 60000);
        await fixture.pool.query(`CREATE TABLE test_ingest_delay (ms integer); INSERT INTO test_ingest_delay VALUES (10);
            CREATE FUNCTION test_slow_insert() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN PERFORM pg_sleep((SELECT ms::float / 1000 FROM test_ingest_delay)); RETURN NEW; END $$;
            CREATE TRIGGER test_slow_insert BEFORE INSERT ON segments FOR EACH ROW EXECUTE FUNCTION test_slow_insert()`);
    });
    after(async () => {
        await stopChild(fixture.child);
        await fixture.channel?.close().catch(() => {});await fixture.connection?.close().catch(() => {});
        await fixture.pool?.end();await Promise.all([fixture.rabbit?.stop(), fixture.postgres?.stop()]);
    });
    it('drains a large valid backlog without false deadline failures and preserves operator tags on replay', async () => {
        for (let index = 0; index < 600; index += 1) {
            fixture.channel.publish('scada.segments', 'integration-machine', message(index), { persistent: true });
        }
        await until(async () => { return await count(fixture.pool) === 600; }, 60000);
        await until(async () => {
            const queue = await fixture.channel.checkQueue('scada.segments.ingest');return queue.messageCount === 0 && queue.consumerCount === 1;
        });
        assert.equal(fixture.child.exitCode, null, fixture.output);
        await fixture.pool.query('UPDATE segments SET tags=$1 WHERE start_time=$2', ['["operator-label"]', new Date(1700000000000)]);
        const previous = (await fixture.pool.query('SELECT updated_at FROM segments WHERE start_time=$1', [new Date(1700000000000)])).rows[0].updated_at;
        fixture.channel.publish('scada.segments', 'integration-machine', message(0), { persistent: true });
        await until(async () => {
            const row = (await fixture.pool.query('SELECT updated_at FROM segments WHERE start_time=$1', [new Date(1700000000000)])).rows[0];
            return row.updated_at.getTime() > previous.getTime();
        });
        assert.equal((await fixture.pool.query('SELECT tags FROM segments WHERE start_time=$1', [new Date(1700000000000)])).rows[0].tags, '["operator-label"]');
    });
    it('drops readiness across broker loss and recovers exactly one consumer', async () => {
        const original = fixture.child;
        await delay(100);
        await fixture.channel.close();await fixture.connection.close();
        Object.assign(fixture, { channel: null, connection: null });
        const stopped = await fixture.rabbit.exec(['rabbitmqctl', 'stop_app']);assert.equal(stopped.exitCode, 0);
        await until(async () => { return !await healthy(fixture.port); });
        const started = await fixture.rabbit.exec(['rabbitmqctl', 'start_app']);assert.equal(started.exitCode, 0);
        assert.equal(original.exitCode, null, 'transient broker restart must reconnect the original process');
        Object.assign(fixture, { connection: await amqp.connect(fixture.amqpUrl) });
        Object.assign(fixture, { channel: await fixture.connection.createChannel() });
        await until(() => {return healthy(fixture.port)}, 60000);
        await until(async () => { return (await fixture.channel.checkQueue('scada.segments.ingest')).consumerCount === 1; });
        assert.equal(fixture.child.exitCode, null, fixture.output);
    });
    it('exits on a real hung acceptance, keeps the unacknowledged message and replays idempotently in a replacement', async () => {
        await fixture.pool.query('UPDATE test_ingest_delay SET ms=2000');
        const old = fixture.child;
        fixture.channel.publish('scada.segments', 'integration-machine', message(600), { persistent: true });
        await until(() => {return old.exitCode !== null}, 10000);
        assert.notEqual(old.exitCode, 0);
        assert.match(fixture.output, /STOMP acceptance.*timed out/u);
        await until(async () => {
            const queue = await fixture.channel.checkQueue('scada.segments.ingest');return queue.consumerCount === 0 && queue.messageCount === 1;
        });
        // Let any uncertain server-side statement settle; replay is protected by the business key.
        await delay(2200);await fixture.pool.query('UPDATE test_ingest_delay SET ms=0');
        processFor(fixture);await until(() => {return healthy(fixture.port)}, 60000);
        await until(async () => { return await count(fixture.pool) === 601; });
        await until(async () => {
            const queue = await fixture.channel.checkQueue('scada.segments.ingest');return queue.consumerCount === 1 && queue.messageCount === 0;
        });
        assert.equal(await count(fixture.pool), 601, 'uncertain replay duplicated a segment');
        assert.equal(fixture.child.exitCode, null, fixture.output);
    });
    it('fences an isolated heartbeat timer write and replays it after replacement', async () => {
        await fixture.pool.query('UPDATE test_ingest_delay SET ms=2000');
        const old = fixture.child;
        const heartbeat = JSON.parse(message(601));heartbeat.duration = 0;
        fixture.channel.publish('scada.segments', 'integration-machine', Buffer.from(JSON.stringify(heartbeat)), { persistent: true });
        await until(() => {return old.exitCode !== null}, 10000);
        assert.notEqual(old.exitCode, 0);
        assert.match(fixture.output, /STOMP acceptance.*timed out/u);
        await until(async () => {
            const queue = await fixture.channel.checkQueue('scada.segments.ingest');
            return queue.consumerCount === 0 && queue.messageCount === 1;
        });
        await delay(2200);await fixture.pool.query('UPDATE test_ingest_delay SET ms=0');
        processFor(fixture);await until(() => {return healthy(fixture.port)}, 60000);
        await until(async () => { return await count(fixture.pool) === 602; });
        await until(async () => {
            const queue = await fixture.channel.checkQueue('scada.segments.ingest');
            return queue.consumerCount === 1 && queue.messageCount === 0;
        });
        assert.equal(await count(fixture.pool), 602);
    });

    it('overlaps storage for independent machines without adding queue consumers', async () => {
        await fixture.pool.query('UPDATE test_ingest_delay SET ms=30');
        for (let index = 0; index < 250; index += 1) {
            const record = JSON.parse(message(index));record.machine = `parallel-${index % 5}`;
            fixture.channel.publish('scada.segments', record.machine, Buffer.from(JSON.stringify(record)), { persistent: true });
        }
        await until(async () => {
            const result = await fixture.pool.query("SELECT count(*)::int total FROM pg_stat_activity WHERE wait_event='PgSleep'");
            return result.rows[0].total > 1;
        });
        await until(async () => { return await count(fixture.pool) === 852; });
        await until(async () => {
            const queue = await fixture.channel.checkQueue('scada.segments.ingest');
            return queue.consumerCount === 1 && queue.messageCount === 0;
        });
        assert.equal(fixture.child.exitCode, null, fixture.output);
    });

});
