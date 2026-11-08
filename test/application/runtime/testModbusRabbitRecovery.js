import assert from 'node:assert/strict';
import net from 'node:net';
import mqtt from 'mqtt';
import { GenericContainer, Wait } from 'testcontainers';
import createRuntime from '../../../src/application/runtime/runtime.js';
import pipelineAdapters from '../../../src/application/runtime/pipelineAdapters.js';
import runtimeHealth from '../../../src/application/runtime/runtimeHealth.js';

async function until(probe, message, limit = 15000) {
    const deadline = Date.now() + limit;
    async function check() {
        if (await probe()) { return; }
        if (Date.now() > deadline) { throw new Error(message); }
        await new Promise(resolve => { setTimeout(resolve, 50); });
        await check();
    }
    await check();
}
async function device() {
    const sockets = new Set();
    let value = 20;
    const server = net.createServer(socket => {
        sockets.add(socket); socket.on('close', () => { sockets.delete(socket); }); socket.on('error', () => {});
        let pending = Buffer.alloc(0);
        socket.on('data', chunk => {
            pending = Buffer.concat([pending, chunk]);
            while (pending.length >= 6 && pending.length >= 6 + pending.readUInt16BE(4)) {
                const request = pending.subarray(0, 6 + pending.readUInt16BE(4)); pending = pending.subarray(request.length);
                const count = request.readUInt16BE(10);
                const reply = Buffer.alloc(9 + count * 2); request.copy(reply, 0, 0, 7); reply.writeUInt16BE(3 + count * 2, 4);
                reply[7] = 3; reply[8] = count * 2;
                for (let index = 0; index < count; index += 1) { reply.writeUInt16BE(value, 9 + index * 2); }
                socket.write(reply);
            }
        });
    });
    await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve); });
    return { port: server.address().port, sockets, next() { value = 30; }, async stop() {
        for (const socket of sockets) { socket.destroy(); }
        await new Promise(resolve => { server.close(resolve); });
    } };
}

describe('Modbus MQTT recovery after RabbitMQ restart', function () {
    this.timeout(240000);
    it('fails health after broker loss and resumes confirmed fresh cooling in a replacement executor', async function () {
        let broker;
        let subscriber;
        let runtime;
        let health;
        let replacement;
        let recoveredHealth;
        const source = await device();
        const received = [];
        try {
            broker = await new GenericContainer('rabbitmq:3.13-management')
                .withEnvironment({ RABBITMQ_DEFAULT_USER: 'fixture', RABBITMQ_DEFAULT_PASS: 'fixture' })
                .withCopyContentToContainer([{ target: '/etc/rabbitmq/enabled_plugins', content: '[rabbitmq_management,rabbitmq_mqtt].' }])
                .withExposedPorts(1883, 15672)
                .withWaitStrategy(Wait.forHttp('/api/overview', 15672).withBasicCredentials('fixture', 'fixture')).start();
            const url = `mqtt://fixture:fixture@${broker.getHost()}:${broker.getMappedPort(1883)}`;
            subscriber = mqtt.connect(url, { reconnectPeriod: 100 });
            subscriber.on('error', () => {});
            subscriber.on('connect', () => { subscriber.subscribe('COOLING/device/GET/T01/VALUE'); });
            subscriber.on('message', (topic, body) => { received.push({ topic, value: JSON.parse(body.toString()).value }); });
            await until(() => { return subscriber.connected; }, 'subscriber could not connect');
            const request = { taskId: 'cooling', generation: 1, specVersion: 1, spec: { adapter: 'modbus', url,
                config: { devices: `device:127.0.0.1:${source.port}`, address: 0, count: 1,
                    interval: 0.2, threshold: 0, timeout: 1, size: 1,
                    plans: [[{ point: 'holding:0', topic: 'COOLING/device/GET/T01/VALUE' }]] } } };
            runtime = createRuntime({ registry: pipelineAdapters() }); health = await runtimeHealth(runtime, { port: 0 });
            await runtime.apply(request);
            await until(() => { return received.length > 0; }, 'initial cooling sample missing');
            assert.equal((await fetch(`http://127.0.0.1:${health.port}/ready`)).status, 200);
            const stopped = await broker.exec(['rabbitmqctl', 'stop_app']); assert.equal(stopped.exitCode, 0);
            await until(() => { return runtime.status().fatal; }, 'broker loss left publisher falsely healthy');
            const statuses = await Promise.all(['ready', 'live'].map(async path => {
                return (await fetch(`http://127.0.0.1:${health.port}/${path}`)).status;
            }));
            assert.deepEqual(statuses, [503, 503]);
            // Equivalent to the liveness supervisor retiring the failed collector before replacement.
            await runtime.stop().catch(error => { assert.match(error.message, /MQTT|Sink|closed|not connected/u); });
            await until(() => { return source.sockets.size === 0; }, 'old poll must release its connection before replacement');
            source.next();
            const restarted = await broker.exec(['rabbitmqctl', 'start_app']); assert.equal(restarted.exitCode, 0);
            await until(() => { return subscriber.connected; }, 'subscriber did not reconnect');
            replacement = createRuntime({ registry: pipelineAdapters() }); recoveredHealth = await runtimeHealth(replacement, { port: 0 });
            await replacement.apply(request);
            await until(() => { return received.some(row => { return row.value === 30; }); }, 'fresh cooling did not recover');
            assert.equal((await fetch(`http://127.0.0.1:${recoveredHealth.port}/ready`)).status, 200);
            assert.equal(source.sockets.size, 1, 'replacement must own exactly one poll connection');
        } finally {
            await runtime?.stop().catch(() => {}); await replacement?.stop().catch(() => {});
            await health?.stop(); await recoveredHealth?.stop();
            if (subscriber) { await subscriber.endAsync(true); }
            await source.stop(); await broker?.stop();
        }
    });
});
