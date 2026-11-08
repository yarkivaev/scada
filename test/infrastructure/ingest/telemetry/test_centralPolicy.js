import assert from 'node:assert/strict';
import centralPolicy from '../../../../src/infrastructure/ingest/telemetry/centralPolicy.js';

describe('central telemetry policy', function() {
    it('uses a bounded ordered queue and native archive defaults', function() {
        const policy = centralPolicy({ enabled: true });
        assert.deepEqual(policy.forTopic('a'), { compactWindowMs: 60000, historyWindowMs: 604800000, maxHistoryAgeMs: 2592000000, futureSkewMs: 300000 });
        assert.equal(policy.queue, 'scada.telemetry.canonical');
        assert.equal(policy.queueMaxBytes, 1073741824);
        assert.equal(policy.maxPendingBatches, 100000);
    });
    it('applies exact topic overrides without changing other topics', function() {
        const policy = centralPolicy({ enabled: true, topics: [{ topic: 'a', compactWindowMs: 1000 }] });
        assert.equal(policy.forTopic('a').compactWindowMs, 1000);
        assert.equal(policy.forTopic('a/b').compactWindowMs, 60000);
    });
    it('inherits complete topic policies and permits compaction off', function() {
        const policy = centralPolicy({ default: { compactWindowMs: 0, historyWindowMs: 1, maxHistoryAgeMs: 2, futureSkewMs: 0 }, topics: [{ topic: 'a', maxHistoryAgeMs: 3 }] });
        assert.deepEqual(policy.forTopic('a'), { compactWindowMs: 0, historyWindowMs: 1, maxHistoryAgeMs: 3, futureSkewMs: 0 });
    });
    it('rejects unsafe settings and contradictory duplicate topics', function() {
        for (const config of [
            { enabled: true, default: { compactWindowMs: -1 } },
            { enabled: true, default: { deduplicate: false } },
            ...[3600001, Number.MAX_SAFE_INTEGER + 1, -1, 0.5].map((compactWindowMs) => {return { default: { compactWindowMs } }}),
            ...['historyWindowMs', 'maxHistoryAgeMs'].flatMap((key) => {return [0, -1, 59999].map((value) => {return { default: { [key]: value } }})}),
            { default: { futureSkewMs: -1 } },
            ...['compactWindowMs', 'historyWindowMs', 'maxHistoryAgeMs', 'futureSkewMs'].map((key) => {return { default: { [key]: null } }}),
            { default: { thinWindowMs: 0 } },
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
