import assert from 'assert';
import operationStateMemory from '../../../../src/infrastructure/persistence/memory/operations.js';

describe('memoryOperations upsert', function() {
    it('keeps single row when key repeats', async function() {
        const store = { operations: [] };
        const port = operationStateMemory(store);
        const key = `dup-${Math.random()}`;
        const first = {
            machine: 'icht1',
            occurred_at: new Date('2024-06-01T10:00:00.000Z'),
            kind: 'chem',
            key,
            payload: { carbon: 0.1 }
        };
        const second = {
            ...first,
            payload: { carbon: 0.2 }
        };
        await port.upsert(first);
        await port.upsert(second);
        assert.strictEqual(store.operations.length, 1, 'duplicate key must not create second row');
    });
});

describe('memoryOperations listForMachine', function() {
    it('returns only rows matching machine kind and occurred_at window', async function() {
        const store = { operations: [] };
        const port = operationStateMemory(store);
        const inside = {
            machine: 'icht1',
            occurred_at: new Date('2024-06-01T12:00:00.000Z'),
            kind: 'chem',
            key: `in-${Math.random()}`,
            payload: {}
        };
        const outside = {
            ...inside,
            machine: 'icht2',
            key: `out-${Math.random()}`
        };
        store.operations.push(inside, outside);
        const rows = await port.listForMachine('icht1', 'chem', {
            from: new Date('2024-06-01T00:00:00.000Z'),
            to: new Date('2024-06-02T00:00:00.000Z')
        });
        assert.strictEqual(rows.length, 1, 'list must exclude other machines');
    });
});
