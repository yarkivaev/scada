import assert from 'node:assert/strict';
import centralPolicy from '../../../../src/infrastructure/ingest/telemetry/centralPolicy.js';

describe('central telemetry policy', function() {
    it('uses a bounded ordered queue and makes adaptive thinning opt-in', function() {
        const policy = centralPolicy({ enabled: true });
        assert.deepEqual(policy.forTopic('a'), { deduplicate: true, thinWindowMs: 0 });
        assert.equal(policy.queue, 'scada.telemetry.canonical');
        assert.equal(policy.queueMaxBytes, 1073741824);
        assert.equal(policy.maxPendingBatches, 100000);
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
            { enabled: true, maxPendingBatches: 0 },
            { enabled: true, queue: 'amq.reserved' },
            { enabled: true, queue: 'a b' },
            { enabled: true, flushIntervalMs: 2147483648 },
            { enabled: true, topics: [{ topic: 'a/#' }] },
            { enabled: true, default: { topic: 'ignored' } },
            { enabled: true, unknown: 1 }
        ]) { assert.throws(() => { centralPolicy(config); }, /policy|dedup|window|pending|topic/iu); }
    });
});
