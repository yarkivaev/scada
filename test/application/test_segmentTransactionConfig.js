import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDeploymentConfig } from '../../src/application/supervisorSink.js';

describe('segment transaction deployment policy', () => {
    it('takes batch limits and boundary rules from environment without a code release', () => {
        const result = readDeploymentConfig({ SEGMENTS_TX_ENABLED: 'true', SEGMENTS_TX_MAX_MESSAGES: '16',
            SEGMENTS_TX_MAX_BYTES: '4096', SEGMENTS_TX_MAX_WAIT_MS: '75', SEGMENTS_TX_COMPLETED_SEGMENTS: '3',
            SEGMENTS_TX_CONCURRENCY: '2', SEGMENTS_TX_TIMEOUT_MS: '1200',
            SEGMENTS_TX_STATS_INTERVAL_MS: '0', SEGMENTS_DB_POOL_MAX: '4' });
        assert.deepEqual(result.pipeline.transactions, { enabled: true, maxMessages: 16, maxBytes: 4096,
            maxWaitMs: 75, completedSegments: 3, concurrency: 2, timeoutMs: 1200, statsIntervalMs: 0 });
        assert.equal(result.dbPoolMax, 4);
    });
    it('loads plant rules and applies operational overrides', () => {
        const folder = mkdtempSync(join(tmpdir(), 'segment-policy-'));
        try {
            const file = join(folder, 'policy.json');
            writeFileSync(file, JSON.stringify({ enabled: true, maxMessages: 32, completedSegments: 2 }));
            const result = readDeploymentConfig({ SEGMENTS_TX_POLICY_FILE: file, SEGMENTS_TX_MAX_MESSAGES: '8' });
            assert.equal(result.pipeline.transactions.maxMessages, 8);
            assert.equal(result.pipeline.transactions.completedSegments, 2);
        } finally { rmSync(folder, { recursive: true, force: true }); }
    });
    it('can disable batching even when an obsolete policy path is configured', () => {
        const result = readDeploymentConfig({ SEGMENTS_TX_ENABLED: 'false', SEGMENTS_TX_POLICY_FILE: '/missing/policy.json' });
        assert.deepEqual(result.pipeline.transactions, { enabled: false });
    });
    it('rejects invalid or unbounded limits', () => {
        for (const values of [
            { SEGMENTS_TX_MAX_MESSAGES: '0' }, { SEGMENTS_TX_MAX_BYTES: '-1' }, { SEGMENTS_TX_MAX_WAIT_MS: 'NaN' },
            { SEGMENTS_TX_COMPLETED_SEGMENTS: '-1' }, { SEGMENTS_TX_CONCURRENCY: '11' }, { SEGMENTS_TX_TIMEOUT_MS: '0' },
            { SEGMENTS_TX_ENABLED: 'yes' }
        ]) {
            assert.throws(() => { readDeploymentConfig({ SEGMENTS_TX_ENABLED: 'true', ...values }); });
        }
    });
});
