import assert from 'assert';
import operator from '../../../src/domain/operator/operator.js';

describe('operator', function() {
    it('keeps card uid and display name from constructor arguments', function() {
        const uid = `card-${Math.random()}`;
        const op = operator(7, uid, 'Anna', 'Kozlov', 'Anna Kozlov');
        assert.strictEqual(op.cardUid, uid, 'operator did not keep card uid');
    });
});
