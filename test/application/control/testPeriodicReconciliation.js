import assert from 'node:assert/strict';
import periodicReconciliation from '../../../src/application/control/periodicReconciliation.js';

describe('periodic reconciliation', function () {
    it('shares a pending cycle and drains it before stop settles', async function () {
        let resolveCycle;
        let runs = 0;
        const cycle = new Promise((resolve) => { resolveCycle = resolve; });
        const ticker = periodicReconciliation(() => {
            runs += 1;
            return cycle;
        }, { intervalMs: 10000 });
        const running = ticker.tick();
        assert.equal(ticker.tick(), running);
        const stopping = ticker.stop();
        assert.equal(ticker.tick(), running);
        resolveCycle();
        await stopping;
        assert.equal(runs, 1);
        assert.equal(ticker.tick(), null);
    });
});
