/* eslint-disable no-await-in-loop -- Broker/database readiness and controller replacement are sequential fixtures. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { GenericContainer, Wait } from 'testcontainers';
import pg from 'pg';
import amqp from 'amqplib';
import stompit from 'stompit';
import segmentPipeline from '../../../../src/infrastructure/ingest/pipelines/segmentPipeline.js';

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
        FLUSH_INTERVAL: '1', STOMP_ACCEPT_TIMEOUT_MS: '500', STOMP_PREFETCH: '128', RETENTION_ENABLED: 'false', ...fixture.env
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
async function drained(fixture) {
    const response = await fetch(`${fixture.managementUrl}/api/queues/%2F/scada.segments.ingest`, {
        headers: { authorization: `Basic ${Buffer.from('streams:streams').toString('base64')}` }, signal: AbortSignal.timeout(2000)
    });
    assert.equal(response.status, 200);
    const queue = await response.json();
    return queue.messages_ready === 0 && queue.messages_unacknowledged === 0 && queue.consumers === 1;
}
async function writtenAt(fixture, index) {
    const result = await fixture.pool.query('SELECT updated_at FROM segments WHERE machine=$1 AND start_time=$2',
        ['integration-machine', new Date(1700000000000 + index * 60000)]);
    return result.rows[0]?.updated_at.getTime() ?? 0;
}


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
        await until(() => {return drained(fixture)});
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
        const beforeReplay = await writtenAt(fixture, 600);
        processFor(fixture);await until(() => {return healthy(fixture.port)}, 60000);
        await until(async () => { return await writtenAt(fixture, 600) > beforeReplay; });
        await until(async () => { return await count(fixture.pool) === 601; });
        await until(() => {return drained(fixture)});
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
        const beforeReplay = await writtenAt(fixture, 601);
        processFor(fixture);await until(() => {return healthy(fixture.port)}, 60000);
        await until(async () => { return await writtenAt(fixture, 601) > beforeReplay; });
        await until(async () => { return await count(fixture.pool) === 602; });
        await until(() => {return drained(fixture)});
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
        await until(() => {return drained(fixture)});
        assert.equal(fixture.child.exitCode, null, fixture.output);
    });

    describe('transaction batch policy', () => {
        async function empty() {
            return drained(fixture);
        }
        function publish(record) {
            fixture.channel.publish('scada.segments', record.machine, Buffer.from(JSON.stringify(record)), { persistent: true });
        }
        function row(machine, start, name = 'off', duration = 60) {
            return { type: 'segment', machine, name, start, end: start + 60000, duration, tags: [], properties: {} };
        }
        before(async () => {
            await until(() => {return drained(fixture)});
            await stopChild(fixture.child);await fixture.pool.query('UPDATE test_ingest_delay SET ms=0');
            await fixture.pool.query(`CREATE TABLE test_segment_commits (tx bigint, machine text);
                CREATE FUNCTION capture_segment_write() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF NEW.name = 'invalid-test' THEN RAISE EXCEPTION 'invalid fixture row' USING ERRCODE='23514'; END IF;
                    INSERT INTO test_segment_commits VALUES (txid_current(), NEW.machine); RETURN NEW;
                END $$;
                CREATE TRIGGER capture_segment_write BEFORE INSERT ON segments FOR EACH ROW EXECUTE FUNCTION capture_segment_write()`);
            Object.assign(fixture, { env: { SEGMENTS_TX_ENABLED: 'true', SEGMENTS_TX_MAX_MESSAGES: '128', SEGMENTS_TX_MAX_WAIT_MS: '200',
                SEGMENTS_TX_MAX_BYTES: '1048576', SEGMENTS_TX_COMPLETED_SEGMENTS: '0',
                SEGMENTS_TX_CONCURRENCY: '2', SEGMENTS_TX_TIMEOUT_MS: '500', SEGMENTS_DEAD_LETTER_ENABLED: 'true' } });
            processFor(fixture);await until(() => {return healthy(fixture.port)}, 60000);
        });

        it('retains the pending transition that closes an older orphan', async () => {
            const start = 4102444800000;const machine = 'transaction-orphan';
            await fixture.pool.query(`INSERT INTO segments(machine,kind,name,start_time,end_time,duration,tags,properties,resolved)
                VALUES ($1,'phase','off',$2,$3,0,'[]','{}',true)`, [machine, new Date(start), new Date(start + 5000)]);
            publish({ ...row(machine, start + 60000, 'on', 0), end: start + 65000 });
            publish(row(machine, start + 60000, 'on'));
            await until(async () => {
                const result = await fixture.pool.query('SELECT count(*)::int total FROM segments WHERE machine=$1', [machine]);
                return result.rows[0].total === 2;
            });await until(empty);
            const result = await fixture.pool.query('SELECT duration FROM segments WHERE machine=$1 ORDER BY start_time', [machine]);
            assert.deepEqual(result.rows.map(value => {return value.duration}), [1, 60]);
        });
        it('retains same-name continuity effects across a pending-to-terminal transition', async () => {
            const start = 4102448400000;const machine = 'transaction-continuity';
            await fixture.pool.query(`INSERT INTO segments(machine,kind,name,start_time,end_time,duration,tags,properties,resolved)
                VALUES ($1,'phase','on',$2,$3,0,'[]','{}',true)`, [machine, new Date(start), new Date(start + 5000)]);
            publish({ ...row(machine, start + 10000, 'on', 0), end: start + 12000 });
            publish({ ...row(machine, start + 10000, 'on', 10), end: start + 20000 });
            await until(async () => {
                const rows = (await fixture.pool.query('SELECT duration FROM segments WHERE machine=$1', [machine])).rows;
                return rows.length > 1 || rows[0].duration > 0;
            });
            const result = await fixture.pool.query('SELECT start_time,end_time,duration FROM segments WHERE machine=$1 ORDER BY start_time', [machine]);
            assert.equal(result.rows.length, 2);
            assert.deepEqual(result.rows.map(value => {return value.duration}), [0, 10]);
            assert.deepEqual(result.rows.map(value => {return value.end_time.getTime()}), [start + 12000, start + 20000]);
        });
        it('retains repeated pending commands after continuing a closed segment', async () => {
            const start = 4102452000000;const machine = 'transaction-pending-continuity';
            await fixture.pool.query(`INSERT INTO segments(machine,kind,name,start_time,end_time,duration,tags,properties,resolved)
                VALUES ($1,'phase','on',$2,$3,3600,'[]','{}',true)`, [machine, new Date(start), new Date(start + 3600000)]);
            publish({ ...row(machine, start + 3605000, 'on', 0), end: start + 3606000 });
            publish({ ...row(machine, start + 3605000, 'on', 0), end: start + 3607000 });
            await until(async () => {
                const rows = (await fixture.pool.query('SELECT end_time FROM segments WHERE machine=$1 ORDER BY start_time DESC LIMIT 1', [machine])).rows;
                return rows[0]?.end_time.getTime() === start + 3607000;
            });
            const result = await fixture.pool.query('SELECT duration,end_time FROM segments WHERE machine=$1 ORDER BY start_time', [machine]);
            assert.deepEqual(result.rows.map(value => {return value.duration}), [1, 0]);
            assert.deepEqual(result.rows.map(value => {return value.end_time.getTime()}), [start + 1000, start + 3607000]);
        });
        it('commits segment, retag and split-family commands in their shared transaction', async () => {
            const start = 1700100000000;const machine = 'transaction-commands';
            publish(row(machine, start, 'on'));
            publish(row(machine, start + 60000));
            publish({ ...row(machine, start, 'on'), type: 'retag', tags: ['operator'] });
            publish({ type: 'split-family', machine, origin: start + 60000, pieces: [
                { ...row(machine, start + 60000), end: start + 90000, duration: 30, tags: ['planned'] },
                { ...row(machine, start + 90000), end: start + 120000, duration: 30 }
            ] });
            await until(async () => {
                const result = await fixture.pool.query('SELECT count(*)::int total FROM segments WHERE machine=$1', [machine]);
                return result.rows[0].total === 3;
            });await until(empty);
            const result = await fixture.pool.query('SELECT tags FROM segments WHERE machine=$1 ORDER BY start_time', [machine]);
            assert.deepEqual(result.rows.map(value => {return value.tags}), ['["operator"]', '["planned"]', '[]']);
            const commits = await fixture.pool.query('SELECT count(DISTINCT tx)::int total FROM test_segment_commits WHERE machine=$1', [machine]);
            assert.equal(commits.rows[0].total, 1);
            assert.equal(fixture.child.exitCode, null, fixture.output);
        });
        it('batches alternating split/segment commands without dropping their effects or tags', async () => {
            const start = 1700200000000;const machine = 'transaction-snapshots';
            for (let index = 0; index < 500; index += 1) {
                const snapshot = { ...row(machine, start, 'off', 0), end: start + (index + 1) * 1000 };
                publish({ ...snapshot, type: 'split' });publish(snapshot);
            }
            const terminal = { ...row(machine, start), end: start + 501000, duration: 501 };
            publish({ ...terminal, type: 'split' });publish(terminal);
            await until(async () => {
                const result = await fixture.pool.query('SELECT duration FROM segments WHERE machine=$1', [machine]);
                return result.rows[0]?.duration === 501;
            });await until(empty);
            const commits = await fixture.pool.query('SELECT count(*)::int writes,count(DISTINCT tx)::int commits FROM test_segment_commits WHERE machine=$1', [machine]);
            process.stdout.write(`        snapshot fixture: ${JSON.stringify({ messages: 1002, ...commits.rows[0] })}\n`);
            assert.equal(commits.rows[0].writes, 1002);
            assert.ok(commits.rows[0].commits < 125, JSON.stringify(commits.rows[0]));
            await fixture.pool.query('UPDATE segments SET tags=$1 WHERE machine=$2', ['["operator"]', machine]);
            const before = (await fixture.pool.query('SELECT updated_at FROM segments WHERE machine=$1', [machine])).rows[0].updated_at;
            publish(terminal);
            await until(async () => {
                const result = await fixture.pool.query('SELECT updated_at FROM segments WHERE machine=$1', [machine]);
                return result.rows[0].updated_at.getTime() > before.getTime();
            });
            const result = await fixture.pool.query('SELECT tags,duration FROM segments WHERE machine=$1', [machine]);
            assert.equal(result.rows.length, 1);assert.equal(result.rows[0].tags, '["operator"]');assert.equal(result.rows[0].duration, 501);
        });

        it('batches plain pending repeats while preserving every command', async () => {
            const start = 1700250000000;const machine = 'transaction-plain-snapshots';
            for (let index = 0; index < 1000; index += 1) {
                publish({ ...row(machine, start, 'on', 0), end: start + (index + 1) * 1000 });
            }
            publish({ ...row(machine, start, 'on', 1001), end: start + 1001000 });
            await until(async () => {
                const rows = (await fixture.pool.query('SELECT duration FROM segments WHERE machine=$1', [machine])).rows;
                return rows[0]?.duration === 1001;
            });await until(empty);
            const result = await fixture.pool.query('SELECT count(*)::int writes,count(DISTINCT tx)::int commits FROM test_segment_commits WHERE machine=$1', [machine]);
            process.stdout.write(`        plain snapshots: ${JSON.stringify({ messages: 1001, ...result.rows[0] })}\n`);
            assert.equal(result.rows[0].writes, 1001);
            assert.ok(result.rows[0].commits < 125, JSON.stringify(result.rows[0]));
        });
        it('isolates a poison row after rollback while acknowledging the valid neighbours', async () => {
            const start = 1700300000000;const machine = 'transaction-poison';
            publish(row(machine, start, 'on'));publish(row(machine, start + 60000, 'invalid-test'));publish(row(machine, start + 120000));
            await until(async () => {
                const result = await fixture.pool.query('SELECT count(*)::int total FROM segments WHERE machine=$1', [machine]);
                return result.rows[0].total === 2;
            });await until(empty);
            const commits = await fixture.pool.query('SELECT count(DISTINCT tx)::int total FROM test_segment_commits WHERE machine=$1', [machine]);
            assert.equal(commits.rows[0].total, 2);
            assert.equal(fixture.child.exitCode, null, fixture.output);
        });
        it('fences a hung batch, keeps its frame in RabbitMQ and replays after replacement', async () => {
            await fixture.pool.query('UPDATE test_ingest_delay SET ms=2000');
            const machine = 'transaction-timeout';const old = fixture.child;publish(row(machine, 1700400000000));
            await until(() => {return old.exitCode !== null}, 10000);assert.notEqual(old.exitCode, 0);
            await until(async () => {
                const queue = await fixture.channel.checkQueue('scada.segments.ingest');return queue.consumerCount === 0 && queue.messageCount === 1;
            });
            await delay(2200);await fixture.pool.query('UPDATE test_ingest_delay SET ms=0');
            processFor(fixture);await until(() => {return healthy(fixture.port)}, 60000);
            await until(async () => {
                const result = await fixture.pool.query('SELECT count(*)::int total FROM segments WHERE machine=$1', [machine]);
                return result.rows[0].total === 1;
            });await until(empty);
            assert.equal(fixture.child.exitCode, null, fixture.output);
        });
        it('replays a committed batch when its ACK is lost without duplicating rows or tags', async () => {
            await stopChild(fixture.child);
            await until(async () => { return (await fixture.channel.checkQueue('scada.segments.ingest')).consumerCount === 0; });
            const NativeChannel = stompit.Channel;const failures = [];let failed = false;let acknowledged;
            const ackSent = new Promise(resolve => { acknowledged = resolve; });
            stompit.Channel = function Channel(failover) {
                const channel = new NativeChannel(failover);const acknowledge = channel.ack.bind(channel);
                channel.ack = frame => {
                    if (!failed) { failed = true;throw new Error('fixture lost ACK after COMMIT'); }
                    const result = acknowledge(frame);acknowledged();return result;
                };
                return channel;
            };
            const shared = { query(...args) { return fixture.pool.query(...args); }, connect() { return fixture.pool.connect(); }, async end() {} };
            const options = { login: 'streams', passcode: 'streams', host: '/', prefetch: 8, onError() {},
                onFatal(error) { failures.push(error); }, transactions: { enabled: true, maxMessages: 1, timeoutMs: 1000 } };
            const first = segmentPipeline(fixture.stompUrl, fixture.pgUrl, shared, options);let replacement;
            const machine = 'transaction-lost-ack';
            try {
                await first.start();publish(row(machine, 1700500000000));
                await until(() => {return failures.length === 1});
                await until(async () => {
                    const queue = await fixture.channel.checkQueue('scada.segments.ingest');return queue.messageCount === 1 && queue.consumerCount === 0;
                });
                await fixture.pool.query('UPDATE segments SET tags=$1 WHERE machine=$2', ['["operator"]', machine]);
                await first.stop().catch(() => {});
                replacement = segmentPipeline(fixture.stompUrl, fixture.pgUrl, shared, options);
                await replacement.start();await ackSent;
                const result = await fixture.pool.query('SELECT tags FROM segments WHERE machine=$1', [machine]);
                assert.equal(result.rows.length, 1);assert.equal(result.rows[0].tags, '["operator"]');
                assert.equal(failures.length, 1);
                await replacement.stop();
                await until(async () => { return (await fixture.channel.checkQueue('scada.segments.ingest')).consumerCount === 0; });
                assert.equal((await fixture.channel.checkQueue('scada.segments.ingest')).messageCount, 0);
            } finally {
                // eslint-disable-next-line require-atomic-updates
                stompit.Channel = NativeChannel;
                await first.stop().catch(() => {});await replacement?.stop().catch(() => {});
            }
        });

    });

});
