import assert from 'node:assert/strict';
import { encodeBatch, decodeBatch, admissionDomain } from '../../../../src/infrastructure/ingest/telemetry/centralEnvelope.js';
import centralPolicy from '../../../../src/infrastructure/ingest/telemetry/centralPolicy.js';

describe('central ordered admission envelope', function() {
    it('freezes adaptive policy on each observation and preserves exact identities', function() {
        const policy = centralPolicy({ enabled: true, topics: [{ topic: 'a', compactWindowMs: 1000 }] });
        const content = encodeBatch([{ topic: 'a', ts: 0, value: 42 }], policy, 'target');
        const batch = decodeBatch(content, 'target');
        assert.equal(JSON.parse(content).version, 4);
        assert.ok(batch.admittedAt <= Date.now() && batch.admittedAt > Date.now() - 1000);
        assert.match(batch.batchId, /^[a-f0-9]{64}$/u);
        assert.deepEqual(decodeBatch(content, 'target'), batch);
        assert.deepEqual(batch.records, [{ topic: 'a', ts: 0, value: 42, compactWindowMs: 1000, historyWindowMs: 604800000, maxHistoryAgeMs: 2592000000, futureSkewMs: 300000, maxGapMs: 30000 }]);
    });
    it('rejects foreign targets and malformed or overlarge batches before acceptance', function() {
        assert.throws(() => { decodeBatch(encodeBatch([{ topic: 'a', ts: 0, value: 1 }], centralPolicy({}), 'a'), 'b'); }, /target/u);
        for (const content of ['{}', '{"version":2,"records":[]}', 'invalid']) { assert.throws(() => { decodeBatch(content, 'target'); }); }
    });
    it('rejects old envelopes, invalid acceptance times and invalid frozen policies', function() {
        const body = JSON.parse(encodeBatch([{ topic: 'a', ts: 0, value: 1 }], centralPolicy({}), 'target'));
        for (const admittedAt of [undefined, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
            assert.throws(() => {return decodeBatch(JSON.stringify({ ...body, admittedAt }), 'target')}, /admission|acceptance/iu);
        }
        for (const version of [1, 2, 3]) { assert.throws(() => {return decodeBatch(JSON.stringify({ ...body, version }), 'target')}, /version/iu); }
        const spoofed = JSON.parse(encodeBatch([{ topic: 'a', ts: 0, value: 1, admittedAt: 1, compactWindowMs: 1, maxGapMs: 1 }], centralPolicy({}), 'target'));
        assert.notEqual(spoofed.admittedAt, 1);
        assert.equal(spoofed.records[0].compactWindowMs, 60000);
        assert.equal(spoofed.records[0].maxGapMs, 30000);
        const changedTime = JSON.stringify({ ...body, admittedAt: body.admittedAt + 1 });
        assert.notEqual(decodeBatch(changedTime, 'target').batchId, decodeBatch(JSON.stringify(body), 'target').batchId);
        const missingGap = structuredClone(body); delete missingGap.records[0].maxGapMs;
        assert.throws(() => {return decodeBatch(JSON.stringify(missingGap), 'target')}, /frozen/iu);
        const modified = structuredClone(body); modified.records[0].historyWindowMs = 0;
        assert.throws(() => {return decodeBatch(JSON.stringify(modified), 'target')}, /policy|history/iu);
    });
    it('pins broker, virtual host and queue while excluding rotating credentials', function() {
        assert.equal(admissionDomain('amqp://a:b@host/%2f', 'q', 't'), admissionDomain('amqp://c:d@host:5672/', 'q', 't'));
        assert.notEqual(admissionDomain('amqp://host/a', 'q', 't'), admissionDomain('amqp://host/b', 'q', 't'));
        assert.notEqual(admissionDomain('amqp://host/', 'q', 't'), admissionDomain('amqp://host/', 'other', 't'));
    });
});
