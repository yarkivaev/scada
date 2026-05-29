import assert from 'assert';
import metricsStateDisabled from '../../../../src/infrastructure/persistence/memory/metricsDisabled.js';

describe('metricsStateDisabled', function() {
    it('rejects batch insert on central profile', async function() {
        const state = metricsStateDisabled();
        await assert.rejects(
            () => { return state.insertRows([{ topic: 't', ts: new Date(), value: 1 }]); },
            /metrics storage is disabled/u,
            'central profile must not accept metric writes'
        );
    });
});
