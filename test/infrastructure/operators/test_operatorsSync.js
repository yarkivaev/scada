import assert from 'assert';
import operator from '../../../src/domain/operator/operator.js';
import operators from '../../../src/infrastructure/operators/operators.js';
import operatorsSync from '../../../src/infrastructure/operators/operatorsSync.js';

describe('operatorsSync', function() {
    it('start replaces operators after successful central pull', async function() {
        const uid = `sync-${Math.random()}`;
        const provider = operators();
        const source = {
            async pull() {
                return [operator(2, uid, 'Мария', 'Орлова', 'Мария Орлова')];
            }
        };
        const sync = operatorsSync(source, provider, { intervalMs: 60000 });
        await sync.start();
        sync.stop();
        const rows = await provider.list();
        assert.strictEqual(rows[0].cardUid, uid, 'operators sync did not update operators from central');
    });

    it('start keeps previous snapshot when central pull fails', async function() {
        const uid = `stale-${Math.random()}`;
        const provider = operators();
        provider.replace([operator(1, uid, 'Игорь', 'Лебедев', 'Игорь Лебедев')]);
        const source = {
            async pull() {
                throw new Error('central unreachable');
            }
        };
        const sync = operatorsSync(source, provider, { intervalMs: 60000 });
        await sync.start();
        sync.stop();
        const rows = await provider.list();
        assert.strictEqual(rows[0].cardUid, uid, 'operators sync did not keep stale operators on central failure');
    });
});
