import assert from 'node:assert/strict';
import centralPolicy from '../../../../src/infrastructure/ingest/telemetry/centralPolicy.js';

describe('central telemetry policy', function() {
    it('keeps exact receipts and makes thinning opt-in', function() {
        const policy = centralPolicy({ enabled: true });
        assert.deepEqual(policy.forTopic('a'), { deduplicate: true, thinWindowMs: 0 });
    });
    it('applies exact topic overrides without changing other topics', function() {
        const policy = centralPolicy({ enabled: true, topics: [{ topic: 'a', thinWindowMs: 1000 }] });
        assert.equal(policy.forTopic('a').thinWindowMs, 1000);
        assert.equal(policy.forTopic('a/b').thinWindowMs, 0);
    });
    it('rejects unsafe settings and contradictory duplicate topics', function() {
        for (const config of [
            { enabled: true, default: { thinWindowMs: -1 } },
            { enabled: true, default: { deduplicate: false } },
            { enabled: true, topics: [{ topic: 'a' }, { topic: 'a' }] },
            { enabled: true, maxPendingRecords: 0 },
            { enabled: true, flushIntervalMs: 2147483648 },
            { enabled: true, topics: [{ topic: 'a/#' }] },
            { enabled: true, default: { topic: 'ignored' } },
            { enabled: true, unknown: 1 }
        ]) { assert.throws(() => { centralPolicy(config); }, /policy|dedup|window|pending|topic/iu); }
    });
});
