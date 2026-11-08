import assert from 'node:assert/strict';
import mqtt from 'mqtt';
import createRuntime from '../../../src/application/runtime/runtime.js';
import pipelineAdapters from '../../../src/application/runtime/pipelineAdapters.js';
import runtimeHealth from '../../../src/application/runtime/runtimeHealth.js';

const request = { taskId: 'cooling', generation: 1, specVersion: 1, spec: {
    adapter: 'modbus', url: 'mqtt://fixture', config: { devices: 'device:127.0.0.1:1', address: 0, count: 1, interval: 1, threshold: 1, timeout: 1, plans: [[{point: 'holding:0', topic: 'COOLING/device/GET/T01/VALUE'}]] }
} };

describe('Modbus publisher health', function () {
    for (const event of ['close', 'offline', 'error']) {
        it(`fails readiness and liveness when MQTT emits ${event}`, async function () {
            const original = { connect: mqtt.MqttClient.prototype.connect, end: mqtt.MqttClient.prototype.end };
            const transport = {};
            mqtt.MqttClient.prototype.connect = function () {
                transport.client = this; setImmediate(() => { this.emit('connect'); }); return this;
            };
            mqtt.MqttClient.prototype.end = function (force, options, done) { done?.(); return this; };
            const runtime = createRuntime({ registry: pipelineAdapters() });
            const health = await runtimeHealth(runtime, { port: 0 });
            const probe = async (path) => { return (await fetch(`http://127.0.0.1:${health.port}/${path}`)).status; };
            try {
                await runtime.apply(request);
                assert.equal(await probe('ready'), 200);
                transport.client.emit(event, new Error('broker unavailable'));
                assert.equal(await probe('ready'), 503, 'dead publisher must not stay Ready');
                assert.equal(await probe('live'), 503, 'liveness must request a fresh executor');
                assert.equal(runtime.status().tasks[0].health, 'failed');
                await assert.rejects(runtime.apply({ ...request, generation: 2 }), /fatal/u);
            } finally {
                await runtime.stop(); await health.stop();
                Object.assign(mqtt.MqttClient.prototype, original);
            }
        });
    }
    it('does not fail health on an intentional MQTT stop', async function () {
        const { default: mqttSink } = await import('../../../src/infrastructure/streams/mqttSink.js');
        const { EventEmitter } = await import('node:events');
        const events = [];
        const client = new EventEmitter();
        client.end = (force, options, done) => { client.emit('close'); done(); };
        const sink = mqttSink('mqtt://fixture', { connect() { setImmediate(() => { client.emit('connect'); }); return client; },
            onFatal(error) { events.push(error); } });
        await sink.start(); await sink.stop();
        assert.equal(events.length, 0);
    });
});
