import assert from 'assert';
import operator from '../../../src/domain/operator/operator.js';
import operators from '../../../src/infrastructure/operators/operators.js';

describe('operators', function() {
    it('returns empty list before first replace', async function() {
        const provider = operators();
        const rows = await provider.list();
        assert.strictEqual(rows.length, 0, 'operators did not start empty');
    });

    it('returns replaced operators from list', async function() {
        const uid = `memory-${Math.random()}`;
        const provider = operators();
        provider.replace([operator(4, uid, 'Ольга', 'Смирнова', 'Ольга Смирнова')]);
        const rows = await provider.list();
        assert.strictEqual(rows[0].cardUid, uid, 'operators did not expose replaced operator');
    });

    it('returns registration flag after permit', async function() {
        const provider = operators();
        await provider.permit(true);
        const flag = await provider.enabled();
        assert.strictEqual(flag, true, 'operators did not store registration flag');
    });
});
