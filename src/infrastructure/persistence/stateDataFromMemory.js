import alertsStateMemory from './memory/alerts.js';
import checkpointStateMemory from './memory/checkpoints.js';
import ingestCheckpointStateMemory from './memory/ingestCheckpoints.js';
import metricsStateMemory from './memory/metrics.js';
import operationStateMemory from './memory/operations.js';
import segmentStateMemory from './memory/segments.js';

/**
 * In-memory supervisor state bundle for tests and local runs.
 *
 * @param {object} [initial] - optional seed segments, metrics, alerts
 * @returns {object} state data ports with shared seed store
 */
export default function stateDataFromMemory(initial = {}) {
    const store = {
        segments: [...(initial.segments || [])],
        metrics: [...(initial.metrics || [])],
        alerts: [...(initial.alerts || [])],
        operations: [...(initial.operations || [])],
        ingestCheckpoints: [...(initial.ingestCheckpoints || [])]
    };
    return {
        segments: segmentStateMemory(store),
        metrics: metricsStateMemory(store),
        alerts: alertsStateMemory(store),
        checkpoints: checkpointStateMemory(store),
        operations: operationStateMemory(store),
        ingestCheckpoints: ingestCheckpointStateMemory(store),
        seed: store
    };
}
