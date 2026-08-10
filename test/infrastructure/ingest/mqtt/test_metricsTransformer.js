import assert from 'assert';
import metricsCodec from '../../../../src/infrastructure/ingest/mqtt/metricsTransformer.js';

describe('metricsCodec', function() {
    it('transforms valid json message to metrics record', function() {
        const received = [];
        const collector = { accept: (record) => {return received.push(record)} };
        const transformer = metricsCodec(collector);
        const topic = `sensors/${Math.random().toString(36).slice(2)}`;
        const ts = Date.now();
        const value = Math.random() * 100;
        transformer.accept({ topic, payload: JSON.stringify({ ts, value }) });
        assert.strictEqual(received.length, 1, 'should accept one record');
        assert.strictEqual(received[0].topic, topic, 'should preserve topic');
        assert.strictEqual(received[0].ts, ts, 'should preserve timestamp');
        assert.strictEqual(received[0].value, value, 'should preserve value');
    });

    it('skips non json messages without crashing', function() {
        const received = [];
        const collector = { accept: (record) => {return received.push(record)} };
        const transformer = metricsCodec(collector);
        transformer.accept({ topic: 'test', payload: 'Error 247. Sensor is off' });
        transformer.accept({ topic: 'test', payload: 'plain text message' });
        assert.strictEqual(received.length, 0, 'should skip non-json messages');
    });

    it('skips json without value field', function() {
        const received = [];
        const collector = { accept: (record) => {return received.push(record)} };
        const transformer = metricsCodec(collector);
        transformer.accept({ topic: 'test', payload: JSON.stringify({ ts: Date.now() }) });
        assert.strictEqual(received.length, 0, 'should skip json without value');
    });

    it('uses current time when ts is missing', function() {
        const received = [];
        const collector = { accept: (record) => {return received.push(record)} };
        const transformer = metricsCodec(collector);
        const before = Date.now();
        transformer.accept({ topic: 'test', payload: JSON.stringify({ value: 42 }) });
        const after = Date.now();
        assert.strictEqual(received.length, 1, 'should accept record');
        assert(received[0].ts >= before && received[0].ts <= after, 'should use current time');
    });

    it('handles unicode content in topic and payload', function() {
        const received = [];
        const collector = { accept: (record) => {return received.push(record)} };
        const transformer = metricsCodec(collector);
        const topic = `sensor/${Math.random().toString(36).slice(2)}`;
        const value = Math.random();
        transformer.accept({ topic, payload: JSON.stringify({ value, unit: '°C' }) });
        assert.strictEqual(received.length, 1, 'should handle unicode');
        assert.strictEqual(received[0].topic, topic, 'should preserve unicode topic');
    });

    it('accepts raw number payload', function() {
        const received = [];
        const collector = { accept: (record) => {return received.push(record)} };
        const silencer = { warn: () => {} };
        const transformer = metricsCodec(collector, silencer);
        const topic = `MX210/m-${Math.random()}/GET/AI1/VALUE`;
        const value = Math.random() * 500;
        transformer.accept({ topic, payload: String(value) });
        assert.strictEqual(received.length, 1, 'should accept raw number payload');
    });

    it('preserves value from raw number payload', function() {
        const received = [];
        const collector = { accept: (record) => {return received.push(record)} };
        const silencer = { warn: () => {} };
        const transformer = metricsCodec(collector, silencer);
        const value = Math.random() * 500;
        transformer.accept({ topic: 'sensor/x', payload: String(value) });
        assert(Math.abs(received[0].value - value) < 0.001, 'should preserve raw number value');
    });

    it('logs when payload cannot be resolved', function() {
        const received = [];
        const warnings = [];
        const collector = { accept: (record) => {return received.push(record)} };
        const logger = { warn: (msg) => {return warnings.push(msg)} };
        const transformer = metricsCodec(collector, logger);
        transformer.accept({ topic: 'test', payload: 'not json at all' });
        assert.strictEqual(warnings.length, 1, 'should log on non-JSON payload');
    });

    it('logs when json payload has no numeric value', function() {
        const received = [];
        const warnings = [];
        const collector = { accept: (record) => {return received.push(record)} };
        const logger = { warn: (msg) => {return warnings.push(msg)} };
        const transformer = metricsCodec(collector, logger);
        transformer.accept({ topic: 'test', payload: JSON.stringify({ name: 'no value here' }) });
        assert.strictEqual(warnings.length, 1, 'should log on missing numeric value');
    });
});
