import assert from 'assert';
import operator from '../../../src/domain/operator/operator.js';
import operatorsFromCache from '../../../src/infrastructure/operators/operatorsFromCache.js';
import operatorsSync from '../../../src/infrastructure/operators/operatorsSync.js';

describe('operatorsSync', function() {
    it('start replaces cache after successful central pull', async function() {
        const uid = `sync-${Math.random()}`;
        const cache = operatorsFromCache();
        const fetch = {
            async pull() {
                return [operator(2, uid, 'Мария', 'Орлова', 'Мария Орлова')];
            }
        };
        const sync = operatorsSync(fetch, cache, { intervalMs: 60000 });
        await sync.start();
        sync.stop();
        const rows = await cache.list();
        assert.strictEqual(rows[0].cardUid, uid, 'operators sync did not update cache from central');
    });

    it('start keeps previous snapshot when central pull fails', async function() {
        const uid = `stale-${Math.random()}`;
        const cache = operatorsFromCache();
        cache.replace([operator(1, uid, 'Игорь', 'Лебедев', 'Игорь Лебедев')]);
        const fetch = {
            async pull() {
                throw new Error('central unreachable');
            }
        };
        const sync = operatorsSync(fetch, cache, { intervalMs: 60000 });
        await sync.start();
        sync.stop();
        const rows = await cache.list();
        assert.strictEqual(rows[0].cardUid, uid, 'operators sync did not keep stale cache on central failure');
    });
});
