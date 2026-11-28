import assert from 'node:assert/strict';
import { withTelemetryState } from '../../../src/infrastructure/persistence/stateDataFromPool.js';

describe('withTelemetryState', function () {
    it('routes telemetry readings to the selected backend and preserves business checkpoints', function () {
        const original = {
            metrics: {},
            checkpoints: { segment() { return 17; }, readings() { return []; } },
            operations: {}
        };
        const telemetry = { readings() { return [23]; } };
        const result = withTelemetryState(original, telemetry);
        assert.deepEqual(result.checkpoints.readings(), [23]);
        assert.equal(result.checkpoints.segment(), 17);
        assert.equal(result.metrics, telemetry);
        assert.equal(result.operations, original.operations);
    });
});
