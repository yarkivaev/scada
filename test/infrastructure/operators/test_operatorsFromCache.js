import assert from 'assert';
import operator from '../../../src/domain/operator/operator.js';
import operatorsFromCache from '../../../src/infrastructure/operators/operatorsFromCache.js';

describe('operatorsFromCache', function() {
    it('returns empty list before first replace', async function() {
        const cache = operatorsFromCache();
        const rows = await cache.list();
        assert.strictEqual(rows.length, 0, 'cache did not start empty');
    });

    it('returns replaced operators from list', async function() {
        const uid = `cache-${Math.random()}`;
        const cache = operatorsFromCache();
        cache.replace([operator(4, uid, 'Ольга', 'Смирнова', 'Ольга Смирнова')]);
        const rows = await cache.list();
        assert.strictEqual(rows[0].cardUid, uid, 'cache did not expose replaced operator');
    });
});
