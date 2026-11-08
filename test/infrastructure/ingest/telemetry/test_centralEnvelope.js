import assert from 'node:assert/strict';
import { encodeBatch, decodeBatch, admissionDomain } from '../../../../src/infrastructure/ingest/telemetry/centralEnvelope.js';
import centralPolicy from '../../../../src/infrastructure/ingest/telemetry/centralPolicy.js';

describe('central ordered admission envelope', function() {
    it('freezes adaptive policy on each observation and preserves exact identities', function() {
        const policy = centralPolicy({ enabled: true, topics: [{ topic: 'a', thinWindowMs: 1000 }] });
        const content = encodeBatch([{ topic: 'a', ts: 0, value: 42 }], policy, 'target');
        assert.deepEqual(decodeBatch(content, 'target'), [{ topic: 'a', ts: 0, value: 42, thinWindowMs: 1000 }]);
    });
    it('rejects foreign targets and malformed or overlarge batches before acceptance', function() {
        assert.throws(() => { decodeBatch(encodeBatch([{ topic: 'a', ts: 0, value: 1 }], centralPolicy({}), 'a'), 'b'); }, /target/u);
        for (const content of ['{}', '{"version":2,"records":[]}', 'invalid']) { assert.throws(() => { decodeBatch(content, 'target'); }); }
    });
    it('pins broker, virtual host and queue while excluding rotating credentials', function() {
        assert.equal(admissionDomain('amqp://a:b@host/%2f', 'q', 't'), admissionDomain('amqp://c:d@host:5672/', 'q', 't'));
        assert.notEqual(admissionDomain('amqp://host/a', 'q', 't'), admissionDomain('amqp://host/b', 'q', 't'));
        assert.notEqual(admissionDomain('amqp://host/', 'q', 't'), admissionDomain('amqp://host/', 'other', 't'));
    });
});
