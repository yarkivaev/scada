import historyPg from './pg/history.js';
import alertsStatePg from './pg/alerts.js';
import checkpointStatePg from './pg/checkpoints.js';
import metricsStateDisabled from './memory/metricsDisabled.js';
import metricsStatePg from './pg/metrics.js';
import operationStatePg from './pg/operations.js';
import segmentStatePg from './pg/segments.js';

export default function stateDataFromPool(pool, options = {}) {
    const metricsEnabled = options.metricsEnabled !== false;
    const metrics = metricsEnabled ? metricsStatePg(pool) : metricsStateDisabled();
    return {
        segments: segmentStatePg(pool),
        alerts: alertsStatePg(pool),
        metrics,
        history: metricsEnabled ? historyPg(pool, { retentionDays: options.historyRetentionDays ?? 30 }) : undefined,
        checkpoints: checkpointStatePg(pool, metricsEnabled),
        operations: operationStatePg(pool)
    };
}
