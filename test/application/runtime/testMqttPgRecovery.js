import assert from 'node:assert/strict';
import mqtt from 'mqtt';
import pg from 'pg';
import additionalAdapters from '../../../src/application/runtime/additionalAdapters.js';
import createRuntime from '../../../src/application/runtime/runtime.js';

const turn = () => { return new Promise(setImmediate); };

describe('MQTT PostgreSQL failure recovery', function () {
    for (const scenario of [
        { name: 'SQL write', options: { writeTimeoutMs: 15, acceptTimeoutMs: 100 }, code: 'WRITE_TIMEOUT' },
        { name: 'MQTT acceptance', options: { writeTimeoutMs: 100, acceptTimeoutMs: 15 }, code: 'OPERATION_TIMEOUT' }
    ]) {
    it(`fails health on uncertain ${scenario.name} timeout and drains before a fresh executor resumes`, async function () {
        const originals = { pool: pg.Pool, connect: mqtt.MqttClient.prototype.connect, end: mqtt.MqttClient.prototype.end, subscribe: mqtt.MqttClient.prototype.subscribe };
        const transport = {};
        const writes = [];
        let release;
        let poolEnded = false;
        let first = true;
        let pending;
        pg.Pool = class {
            on() {}
            async query(sql, params) {
                writes.push(params);
                if (first) { first = false; pending = new Promise((resolve) => { release = resolve; }); await pending; }
            }
            async end() { await pending; poolEnded = true; }
        };
        mqtt.MqttClient.prototype.connect = function () {
            transport.client = this; this.connackPacket = { sessionPresent: false }; setImmediate(() => { this.emit('connect', { sessionPresent: false }); }); return this;
        };
        mqtt.MqttClient.prototype.subscribe = function (_topics, _options, callback) { callback(null, [{ qos: 1 }]); return this; };
        mqtt.MqttClient.prototype.end = function (force, options, done) { done?.(); return this; };
        const spec = { adapter: 'mqtt-pg-metrics', mqtt: 'mqtt://broker', postgres: 'postgres://db/store', topic: 'wire/#',
            options: { clientId: 'persistent-client', ...scenario.options } };
        const request = { taskId: 'metrics', generation: 1, specVersion: 1, spec };
        const registry = additionalAdapters();
        const runtime = createRuntime({ registry });
        let replacement;
        try {
            await runtime.apply(request);
            assert.equal(runtime.status().tasks[0].health, 'degraded');
            await turn();
            transport.client.emit('offline');
            assert.equal(runtime.status().tasks[0].health, 'degraded');
            transport.client.emit('error', new Error('broker disconnected'));
            assert.equal(runtime.status().tasks[0].health, 'degraded');
            transport.client.emit('connect', { sessionPresent: false });
            assert.equal(runtime.status().tasks[0].health, 'running');
            const error = await new Promise((resolve) => {
                transport.client.handleMessage({ topic: 'wire/value', payload: Buffer.from('42') }, resolve);
            });
            assert.equal(error.code, scenario.code);
            assert.equal(runtime.status().fatal, true);
            assert.equal(runtime.status().tasks[0].health, 'failed');
            await assert.rejects(runtime.apply({ ...request, generation: 2 }), /fatal/u);
            const stopping = runtime.stop(); await turn();
            assert.equal(poolEnded, false, 'old SQL must drain before pool closes');
            release(); await stopping;
            assert.equal(poolEnded, true);
            replacement = createRuntime({ registry });
            await replacement.apply(request); await turn();
            const ack = await new Promise((resolve) => {
                transport.client.handleMessage({ topic: 'wire/value', payload: Buffer.from('43') }, resolve);
            });
            assert.equal(ack, undefined);
            assert.equal(replacement.status().fatal, false);
            assert.equal(replacement.status().tasks[0].health, 'running');
            assert.equal(writes.length, 2);
        } finally {
            release?.(); await runtime.stop(); await replacement?.stop();
            // eslint-disable-next-line require-atomic-updates
            pg.Pool = originals.pool;
            Object.assign(mqtt.MqttClient.prototype, { connect: originals.connect, end: originals.end, subscribe: originals.subscribe });
        }
    });
    }
});
