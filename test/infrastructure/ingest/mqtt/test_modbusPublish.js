import assert from 'node:assert';
import mqtt from 'mqtt';
import ModbusRTU from 'modbus-serial';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'mocha';
import modbusPublish, { measurementPlans } from '../../../../src/infrastructure/ingest/mqtt/modbusPublish.js';
import registerPublish from '../../../../src/infrastructure/ingest/mqtt/registerPublish.js';
import { decodePoint } from '../../../../src/infrastructure/ingest/mqtt/registerPoint.js';

describe('register point', () => {
    it('decodes one uint16 holding register', () => {
        const origin = 1000 + Math.floor(Math.random() * 50);
        const value = Math.floor(Math.random() * 60000) + 3;
        assert.strictEqual(
            decodePoint(`holding:${origin}`, origin, [value]),
            value,
            'a holding point did not return the uint16 in the window'
        );
    });

    it('decodes an abcd float from the register window', () => {
        const origin = 2000 + Math.floor(Math.random() * 40);
        assert.strictEqual(
            decodePoint(`holding:${origin}:abcd`, origin, [16256, 0]),
            1,
            'abcd word order did not decode the float 1'
        );
    });

    it('decodes a cdab float from the register window', () => {
        const origin = 3000 + Math.floor(Math.random() * 40);
        assert.strictEqual(
            decodePoint(`holding:${origin}:cdab`, origin, [0, 16256]),
            1,
            'cdab word order did not decode the float 1'
        );
    });
});

describe('modbusPublish', () => {
    it('names a measurement by the document path', () => {
        const stem = `mill/ünit-${Math.random().toString(36).slice(2, 6)}/electrical`;
        const received = [];
        const plans = measurementPlans(stem, { voltage: 'holding:4000:cdab' });
        const transformer = registerPublish(plans, 4000, {
            accept(record) {
                received.push(record);
            }
        });
        transformer.accept([32768, 17254]);
        assert.strictEqual(
            received[0].topic,
            `${stem}/voltage`,
            'the collector published voltage on a device topic'
        );
    });

    it('uses the parameter id when the stream is empty', () => {
        const key = `p${Math.random().toString(36).slice(2, 6)}`;
        const received = [];
        const plans = measurementPlans('', { [key]: 'holding:8' });
        const transformer = registerPublish(plans, 8, {
            accept(record) {
                received.push(record);
            }
        });
        transformer.accept([41]);
        assert.strictEqual(
            received[0].topic,
            key,
            'an empty stream invented a device topic'
        );
    });

    it('builds a pipeline for a mapped device address', () => {
        const host = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
        const stem = `bay/ünit-${Math.random().toString(36).slice(2, 5)}`;
        const pipeline = modbusPublish(`mqtt://broker-${Math.random().toString(36).slice(2)}`, {
            addresses: [`modbus://${host}:502?at=4000&count=2`],
            clientId: `modbus-${Math.random().toString(36).slice(2, 6)}`,
            interval: 5,
            maps: [{ voltage: 'holding:4000:abcd' }],
            streams: [stem],
            threshold: 5,
            timeout: 60
        });
        assert.strictEqual(
            typeof pipeline.start,
            'function',
            'a mapped address did not build a modbus pipeline'
        );
    });

    it('reads document paths from STREAM and MAPPING', () => {
        const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
        const source = fs.readFileSync(path.join(root, 'src/bin/modbus-to-mqtt.js'), 'utf8');
        assert.strictEqual(
            source.includes('process.env.STREAM')
                && source.includes('process.env.MAPPING')
                && source.includes('process.env.ADDRESS')
                && source.includes('process.env.PATH') === false,
            true,
            'modbus-to-mqtt took document paths from PATH'
        );
    });
});


describe('explicit modbus wire plans', function () {
    const config = { addresses: ['modbus://192.0.2.1:502'], interval: 5, threshold: 5, timeout: 60,
        plans: [[{ point: 'holding:4000:abcd', topic: 'legacy/device/voltage' }]] };
    it('derives the window from explicit plans without a generated mapping', function () {
        assert.equal(typeof modbusPublish('mqtt://broker', config).start, 'function');
    });
    it('requires exactly one plan array per device', function () {
        for (const plans of [[], {}, [null], [config.plans[0], config.plans[0]]]) {
            assert.throws(() => { modbusPublish('mqtt://broker', { ...config, plans }); }, /plan/iu);
        }
    });
    it('rejects ambiguous generated mappings and duplicate wire topics', function () {
        assert.throws(() => { modbusPublish('mqtt://broker', { ...config, maps: [{ voltage: 'holding:4000:abcd' }] }); }, /plan|mapping/iu);
        assert.throws(() => { modbusPublish('mqtt://broker', { ...config, plans: [[...config.plans[0], ...config.plans[0]]] }); }, /duplicate/iu);
    });
    it('validates explicit points, topics and poll window fit', function () {
        for (const item of [{ point: 'no-point', topic: 'a' }, { point: 'holding:4000', topic: '' }, { point: 'holding:4000', topic: 'wild/#' }]) {
            assert.throws(() => { modbusPublish('mqtt://broker', { ...config, plans: [[item]] }); });
        }
        assert.throws(() => { modbusPublish('mqtt://broker', { ...config, address: 0, count: 2 }); }, /outside/u);
    });
});


describe('explicit Modbus wire publication', function () {
    it('publishes the explicit topic and decoded value exactly once per sampled point', async function () {
        const mqttOriginal = { connect: mqtt.MqttClient.prototype.connect, end: mqtt.MqttClient.prototype.end,
            publish: mqtt.MqttClient.prototype.publish };
        const modbusOriginal = { connectTCP: ModbusRTU.prototype.connectTCP, readHoldingRegisters: ModbusRTU.prototype.readHoldingRegisters };
        const received = [];
        let sampled;
        const ready = new Promise((resolve) => { sampled = resolve; });
        mqtt.MqttClient.prototype.connect = function () { setImmediate(() => { this.emit('connect'); }); return this; };
        mqtt.MqttClient.prototype.end = function (force, options, done) { done?.(); return this; };
        mqtt.MqttClient.prototype.publish = function (topic, payload, options, done) {
            received.push({ topic, payload: JSON.parse(payload), qos: options.qos }); done(); return this;
        };
        ModbusRTU.prototype.connectTCP = function () { return Promise.resolve(); };
        ModbusRTU.prototype.readHoldingRegisters = function (address, count) {
            assert.equal(address, 4000); assert.equal(count, 2);
            sampled(); return Promise.resolve({ data: [16256, 0] });
        };
        const pipeline = modbusPublish('mqtt://broker', { addresses: ['modbus://192.0.2.1:502'],
            interval: 0.01, threshold: 5, timeout: 60,
            plans: [[{ point: 'holding:4000:abcd', topic: 'legacy/device/voltage' }]] });
        try {
            await pipeline.start(); await ready; await new Promise(setImmediate);
            await pipeline.stop();
            assert.equal(received.length, 1);
            assert.equal(received[0].topic, 'legacy/device/voltage');
            assert.equal(received[0].payload.value, 1);
            assert.equal(typeof received[0].payload.ts, 'number');
            assert.equal(received[0].qos, 1);
        } finally {
            await pipeline.stop();
            Object.assign(mqtt.MqttClient.prototype, mqttOriginal);
            Object.assign(ModbusRTU.prototype, modbusOriginal);
        }
    });
});


describe('explicit Modbus plan point grammar', function () {
    it('rejects partially parsed addresses, extra fields and register overflow', function () {
        const config = { addresses: ['modbus://192.0.2.1:502'], interval: 5, threshold: 5, timeout: 60 };
        for (const point of ['holding:4000oops', 'holding:4000.5', 'holding:4000:abcd:extra',
            'holding:65536', 'holding:65535:abcd', 'holding:9007199254740992']) {
            assert.throws(() => { modbusPublish('mqtt://broker', { ...config, plans: [[{ point, topic: 'legacy/value' }]] }); }, /point|register/iu);
        }
    });
});
