import assert from 'node:assert/strict';
import segmentBatchStats from '../../src/application/segmentBatchStats.js';

describe('transaction batch tuning counters', () => {
    it('reports committed messages separately from rollback attempts and resets each interval', () => {
        let clock = 0;const output = [];
        const stats = segmentBatchStats(100, line => { output.push(JSON.parse(line.slice('[segment-transactions] '.length))); }, () => {return clock});
        stats({ committed: true, messages: 10, records: 2, sqlCalls: 8, durationMs: 25, waitMs: 40 });
        clock = 50;stats({ committed: false });assert.deepEqual(output, []);
        clock = 100;stats({ committed: true, messages: 2, records: 1, sqlCalls: 3, durationMs: 50, waitMs: 10 });
        assert.deepEqual(output, [{ intervalMs: 100, commits: 2, rollbacks: 1, messages: 12, records: 3, sqlCalls: 11, maxTransactionMs: 50, maxWaitMs: 40 }]);
        clock = 200;stats({ committed: true, messages: 1, records: 1, sqlCalls: 3, durationMs: 1, waitMs: 1 });
        assert.equal(output[1].messages, 1);assert.equal(output[1].rollbacks, 0);
    });
});
