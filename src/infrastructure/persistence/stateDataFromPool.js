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
        history: metricsEnabled ? historyPg(pool, { retentionDays: options.historyRetentionDays ?? 30, ...options.historyPolicy }) : undefined,
        checkpoints: checkpointStatePg(pool, metricsEnabled, options.checkpointPolicy),
        operations: operationStatePg(pool)
    };
}


/** Route telemetry and checkpoint readings to the selected backend, preserving business state. */
export function withTelemetryState(data, metrics, history = data.history) {
    return {
        ...data,
        metrics,
        history,
        checkpoints: {
            ...data.checkpoints,
            readings(topics, from) { return metrics.readings(topics, from); }
        }
    };
}
