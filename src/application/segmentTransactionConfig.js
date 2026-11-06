import { readFileSync } from 'node:fs';
import segmentBatchPolicy from '../infrastructure/ingest/pipelines/segmentBatchPolicy.js';

const variables = { maxMessages: 'MAX_MESSAGES', maxBytes: 'MAX_BYTES', maxWaitMs: 'MAX_WAIT_MS',
    completedSegments: 'COMPLETED_SEGMENTS', concurrency: 'CONCURRENCY', timeoutMs: 'TIMEOUT_MS', statsIntervalMs: 'STATS_INTERVAL_MS' };

function loadPolicy(env) {
    const policy = env.SEGMENTS_TX_POLICY_FILE ? JSON.parse(readFileSync(env.SEGMENTS_TX_POLICY_FILE, 'utf8')) : {};
    if (env.SEGMENTS_TX_ENABLED !== undefined) {
        if (!['true', 'false'].includes(env.SEGMENTS_TX_ENABLED)) { throw new TypeError('SEGMENTS_TX_ENABLED must be true or false'); }
        policy.enabled = env.SEGMENTS_TX_ENABLED === 'true';
    }
    for (const [key, suffix] of Object.entries(variables)) {
        const value = env[`SEGMENTS_TX_${suffix}`];
        if (value !== undefined) { policy[key] = Number(value); }
    }
    return policy;
}
/** Plant policy supplies defaults; a ConfigMap can override every operational setting. */
export default function segmentTransactionConfig(env, poolMax) {
    if (env.SEGMENTS_TX_ENABLED === 'false') { return { enabled: false }; }
    if (!env.SEGMENTS_TX_POLICY_FILE && !Object.keys(env).some(key => {return key.startsWith('SEGMENTS_TX_')})) { return { enabled: false }; }
    const result = segmentBatchPolicy(loadPolicy(env));
    if (result.enabled && result.concurrency > poolMax) { throw new TypeError('Transaction concurrency exceeds SEGMENTS_DB_POOL_MAX'); }
    return result;
}
