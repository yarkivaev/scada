import assert from 'assert';
import operator from '../../../src/domain/operator/operator.js';
import operatorsFromSeed from '../../../src/infrastructure/operators/operatorsFromSeed.js';

describe('operatorsFromSeed', function() {
    it('returns seeded operators from list', async function() {
        const uid = `seed-${Math.random()}`;
        const source = operatorsFromSeed([operator(3, uid, 'Petr', 'Ivanov', 'Petr Ivanov')]);
        const rows = await source.list();
        assert.strictEqual(rows[0].cardUid, uid, 'seed operators source did not return seeded operator');
    });
});
