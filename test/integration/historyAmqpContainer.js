/* eslint-disable no-await-in-loop, require-atomic-updates -- Mocha runs fixture mutations sequentially; services are polled in order. */
import assert from 'node:assert/strict';
import { GenericContainer, Wait } from 'testcontainers';
import amqp from 'amqplib';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import historyTelemetry from '../../src/infrastructure/ingest/telemetry/historyTelemetry.js';
import amqpSink from '../../src/infrastructure/streams/amqpSink.js';
import historyPg from '../../src/infrastructure/persistence/pg/history.js';
async function until(probe) {
    const end = Date.now() + 20000;
    while (!await probe()) {
        if (Date.now() > end) { throw new Error('Durable receiver condition timed out'); }
        await new Promise((resolve) => { setTimeout(resolve, 50); });
    }
}
describe('Local history durable AMQP integration', function receiverTests() {
    this.timeout(180000);
    let rabbit;
    let postgres;
    let pool;
    let sink;
    let receiver;
    let connection;
    let channel;
    let url;
    const queue = 'scada.telemetry.history';
    const patterns = ['MX210.icht-1.#'];
    const time = Date.now() - 1000;
    before(async () => {
        rabbit = await new GenericContainer('rabbitmq:3.13-management').withEnvironment({ RABBITMQ_DEFAULT_USER: 'test', RABBITMQ_DEFAULT_PASS: 'test' }).withExposedPorts(5672).withWaitStrategy(Wait.forListeningPorts()).start();
        postgres = await new GenericContainer('postgres:16-alpine').withEnvironment({ POSTGRES_PASSWORD: 'test' }).withExposedPorts(5432).start();
        pool = new pg.Pool({ host: postgres.getHost(), port: postgres.getMappedPort(5432), user: 'postgres', password: 'test' });
        await until(async () => { try { await pool.query('SELECT 1'); return true; } catch { return false; } });
        for (const name of ['V0001__baseline.sql', 'V0008__segments_updated_at.sql', 'E0001__edge_metrics.sql', 'E0006__historical_telemetry.sql', 'E0007__metric_receipts.sql', 'E0009__history_continuation.sql']) {
            await pool.query(await readFile(new URL(`../../db/migrations/${name}`, import.meta.url), 'utf8'));
        }
        await historyPg(pool).configure('icht1', [{ topic: 'MX210/icht-1/GET/AI3/VALUE', channel: 'power' }]);
        url = `amqp://test:test@${rabbit.getHost()}:${rabbit.getMappedPort(5672)}`;
        connection = await amqp.connect(url); connection.on('error', () => {}); channel = await connection.createChannel(); channel.on('error', () => {});
        await channel.assertExchange('scada.telemetry', 'topic', { durable: true });
        await channel.assertQueue('unrelated.central.outbox', { durable: true });
        await channel.bindQueue('unrelated.central.outbox', 'scada.telemetry', '#');
        sink = amqpSink(url, { exchanges: [{ name: 'scada.telemetry', type: 'topic', options: { durable: true } }],
            queues: [{ name: queue, options: { durable: true, autoDelete: false } }],
            bindings: patterns.map((pattern) => { return { queue, exchange: 'scada.telemetry', pattern }; }), retryMs: 100, onError() {} });
        await sink.start();
    });
    after(async () => { await receiver?.stop(); await sink?.stop(); await channel?.close().catch(() => {}); await connection?.close().catch(() => {}); await pool?.end(); await rabbit?.stop(); await postgres?.stop(); });
    function publish(offset) {
        return sink.write([{ exchange: 'scada.telemetry', routingKey: 'MX210.icht-1.GET.AI3.VALUE', body: JSON.stringify({ ts: time + offset, value: 10 + offset }), options: { persistent: true, mandatory: true } }]);
    }
    function consumer(database = pool) {
        return historyTelemetry({ HISTORY_AMQP_ENABLED: 'true', HISTORY_AMQP_URL: url, HISTORY_AMQP_QUEUE: queue, HISTORY_AMQP_BINDINGS: JSON.stringify(patterns) }, database);
    }
    it('retains confirmed local telemetry without any receiver and across broker restart', async () => {
        await publish(0);
        assert.equal((await channel.checkQueue(queue)).messageCount, 1);
        assert.equal((await channel.checkQueue('unrelated.central.outbox')).messageCount, 1);
        assert.equal((await rabbit.exec(['rabbitmqctl', 'stop_app'])).exitCode, 0);
        await until(() => { return !sink.active(); });
        assert.equal((await rabbit.exec(['rabbitmqctl', 'start_app'])).exitCode, 0);
        await until(() => { return sink.active(); });
        connection = await amqp.connect(url); connection.on('error', () => {}); channel = await connection.createChannel(); channel.on('error', () => {});
        assert.equal((await channel.checkQueue(queue)).messageCount, 1);
        receiver = consumer(); await receiver.start();
        await until(async () => { return (await pool.query('SELECT count(*) AS n FROM history_observations')).rows[0].n === '1'; });
        assert.equal((await historyPg(pool).work('icht1')).items.length, 1);
        await receiver.stop(); receiver = null;
        await publish(1);
        assert.equal((await channel.checkQueue(queue)).messageCount, 1);
        receiver = consumer(); await receiver.start();
        await until(async () => { return (await pool.query('SELECT count(*) AS n FROM history_observations')).rows[0].n === '2'; });
    });
    it('leaves the delivery unacknowledged until its PostgreSQL write finishes', async () => {
        await receiver.stop();
        let release;
        let writing;
        const entered = new Promise((resolve) => { writing = resolve; });
        const gate = new Promise((resolve) => { release = resolve; });
        receiver = consumer({ async query(...args) { writing(); await gate; return pool.query(...args); } });
        await receiver.start(); await publish(2); await entered;
        assert.equal((await pool.query('SELECT count(*) AS n FROM history_observations')).rows[0].n, '2');
        // Kill the AMQP session while the write is held: broker must redeliver after reconnection.
        assert.equal((await rabbit.exec(['rabbitmqctl', 'stop_app'])).exitCode, 0);
        release();
        assert.equal((await rabbit.exec(['rabbitmqctl', 'start_app'])).exitCode, 0);
        await until(async () => { return (await pool.query('SELECT count(*) AS n FROM history_observations')).rows[0].n === '3'; });
        await until(async () => { return Number((await pool.query('SELECT count(*) AS n FROM metrics')).rows[0].n) === 3; });
        assert.equal((await pool.query('SELECT count(*) AS n FROM history_observations WHERE time_ms=$1', [time + 2])).rows[0].n, '1');
    });
});
