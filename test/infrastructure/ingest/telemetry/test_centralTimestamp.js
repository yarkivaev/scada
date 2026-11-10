import assert from 'node:assert/strict';
import metricsCodec from '../../../../src/infrastructure/ingest/mqtt/metricsTransformer.js';
import centralMetricPoint from '../../../../src/infrastructure/ingest/telemetry/centralPoint.js';

describe('central original timestamps', function() {
    it('preserves epoch zero through the broker codec', function() {
        const records = [];
        const codec = metricsCodec({ accept(point) { records.push(point); } }, console, { requireTimestamp: true });
        codec.accept({ topic: 'a', payload: '{"ts":0,"value":1}' });
        assert.equal(records[0].ts, 0);
    });
    it('rejects payloads which cannot have a stable identity or valid finite value', function() {
        const records = [];
        const codec = metricsCodec({ accept(point) { records.push(point); } }, console, { requireTimestamp: true });
        for (const payload of ['42', '{"value":1}', '{"ts":1,"value":1e999}', 'invalid']) {
            assert.throws(() => { codec.accept({ topic: 'a', payload }); }, /timestamp|JSON/u);
        }
        assert.equal(records.length, 0);
    });
    it('normalizes exported ISO timestamps and rejects points outside supported ClickHouse range', function() {
        assert.equal(centralMetricPoint({ topic: 'a', ts: '1970-01-01T00:00:00.000Z', value: 1 }).ts, 0);
        for (const ts of [Number.MAX_SAFE_INTEGER, -2208988800001, 10413792000000, '1', '2026-02-30T00:00:00.000Z', NaN]) {
            assert.throws(() => { centralMetricPoint({ topic: 'a', ts, value: 1 }); }, /timestamp/u);
        }
    });
});
