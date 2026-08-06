import assert from 'assert';
import operatorExtras from '../../../src/infrastructure/operators/operatorExtras.js';

describe('operatorExtras', function() {
    it('keeps plant-owned fields outside the reserved identity keys', function() {
        const code = `plant-${Math.random().toString(36).slice(2)}`;
        const extra = operatorExtras(
            {
                id: 9,
                cardUid: 'CARD',
                firstName: 'Иван',
                lastName: 'Петров',
                displayName: 'Иван Петров',
                plantCode: code
            },
            ['id', 'cardUid', 'firstName', 'lastName', 'displayName']
        );
        assert.deepStrictEqual(
            extra,
            { plantCode: code },
            'operatorExtras dropped plant-owned fields outside identity'
        );
    });
});
