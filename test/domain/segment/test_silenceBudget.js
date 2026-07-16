import assert from 'assert';
import silenceBudget from '../../../src/domain/segment/silenceBudget.js';

describe('silenceBudget', function() {
    it('doubles the supervisor machine window', function() {
        const window = Math.floor(Math.random() * 20) + 1;
        assert.strictEqual(
            silenceBudget(window),
            window * 2,
            'silence budget must equal window times two'
        );
    });

    it('throws when window is not a positive number', function() {
        assert.throws(
            () => { silenceBudget(0); },
            /Window must be a positive number/u,
            'non-positive window was not rejected'
        );
    });
});
