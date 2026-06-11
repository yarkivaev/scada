import assert from 'assert';
import { operation } from '../../../src/domain/operation/operation.js';

describe('operation', function() {
    it('returns operation with correct machine', function() {
        const machine = `mx-${Math.random()}`;
        const created = operation(
            machine,
            new Date(),
            'chem',
            `key-${Math.random()}`,
            { value: 1 },
            new Date(),
            `src-${Math.random()}`,
            new Date()
        );
        assert(created.machine === machine, 'machine mismatch');
    });
});
