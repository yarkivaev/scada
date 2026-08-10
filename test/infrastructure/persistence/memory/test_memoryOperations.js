import assert from 'assert';
import operationStateMemory from '../../../../src/infrastructure/persistence/memory/operations.js';

describe('memoryOperations upsert', function() {
    it('keeps single row when key repeats', async function() {
        const store = { operations: [] };
        const port = operationStateMemory(store);
        const key = `dup-${Math.random()}`;
        const first = {
            machine: 'm1',
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
            machine: 'm1',
            occurred_at: new Date('2024-06-01T12:00:00.000Z'),
            kind: 'chem',
            key: `in-${Math.random()}`,
            payload: {}
        };
        const outside = {
            ...inside,
            machine: 'm2',
            key: `out-${Math.random()}`
        };
        store.operations.push(inside, outside);
        const rows = await port.listForMachine('m1', 'chem', {
            from: new Date('2024-06-01T00:00:00.000Z'),
            to: new Date('2024-06-02T00:00:00.000Z')
        });
        assert.strictEqual(rows.length, 1, 'list must exclude other machines');
    });
});

describe('memoryOperations get', function() {
    it('returns row scoped to machine and key', async function() {
        const store = { operations: [] };
        const port = operationStateMemory(store);
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const key = `key-${Math.random().toString(36).slice(2)}`;
        const row = {
            machine: machineId,
            occurred_at: new Date('2024-06-01T12:00:00.000Z'),
            kind: 'chem',
            key,
            payload: { lot: 'α' }
        };
        store.operations.push(row, {
            ...row,
            machine: `other-${Math.random()}`,
            key: `alien-${Math.random()}`
        });
        const found = await port.get(machineId, key);
        assert.strictEqual(found.key, key, 'get cannot miss existing machine-scoped key');
    });

    it('rejects when key is absent for machine', async function() {
        const store = { operations: [] };
        const port = operationStateMemory(store);
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        await assert.rejects(
            () => {
                return port.get(machineId, `missing-${Math.random()}`);
            },
            (err) => {
                return err instanceof Error;
            },
            'get cannot succeed for unknown key'
        );
    });
});

describe('memoryOperations remove', function() {
    it('deletes row scoped to machine and key', async function() {
        const store = { operations: [] };
        const port = operationStateMemory(store);
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const key = `del-${Math.random().toString(36).slice(2)}`;
        store.operations.push({
            machine: machineId,
            occurred_at: new Date('2024-06-01T12:00:00.000Z'),
            kind: 'bath',
            key,
            payload: { action: 'load' }
        });
        await port.remove(machineId, key);
        assert.strictEqual(store.operations.length, 0, 'remove cannot leave deleted row');
    });

    it('rejects when key belongs to another machine', async function() {
        const store = { operations: [] };
        const port = operationStateMemory(store);
        const key = `other-${Math.random().toString(36).slice(2)}`;
        store.operations.push({
            machine: `owner-${Math.random()}`,
            occurred_at: new Date('2024-06-01T12:00:00.000Z'),
            kind: 'chem',
            key,
            payload: {}
        });
        await assert.rejects(
            () => {
                return port.remove(`other-${Math.random()}`, key);
            },
            (err) => {
                return err instanceof Error;
            },
            'remove cannot delete key for wrong machine'
        );
    });
});
