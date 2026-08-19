import assert from 'assert';
import operations from '../../../src/domain/operation/operations.js';
import operationStateMemory from '../../../src/infrastructure/persistence/memory/operations.js';
import pubsub from '../../../src/domain/shared/pubsub.js';

describe('operations upsert', function() {
    it('emits created when persistence inserts new row', async function() {
        const store = { operations: [] };
        const persistence = operationStateMemory(store);
        const bus = pubsub();
        const events = [];
        bus.stream((event) => {
            events.push(event);
        });
        const ops = operations(persistence, bus);
        const key = `new-${Math.random()}`;
        await ops.upsert({
            machine: 'm1',
            occurred_at: new Date(),
            kind: 'chem',
            key,
            payload: { lot: 'α' }
        });
        assert.strictEqual(events[0].type, 'created', 'new row must emit created');
    });
});

describe('operations upsertMany', function() {
    it('emits created for each inserted row in request order', async function() {
        const store = { operations: [] };
        const persistence = operationStateMemory(store);
        const bus = pubsub();
        const events = [];
        bus.stream((event) => {
            events.push(event);
        });
        const ops = operations(persistence, bus);
        const first = `first-${Math.random()}`;
        const second = `second-${Math.random()}`;
        await ops.upsertMany([
            {
                machine: 'm1',
                occurred_at: new Date('2024-06-01T10:00:00.000Z'),
                kind: 'load',
                key: first,
                payload: { lot: 'α' }
            },
            {
                machine: 'm1',
                occurred_at: new Date('2024-06-01T10:00:00.001Z'),
                kind: 'load',
                key: second,
                payload: { lot: 'β' }
            }
        ]);
        assert.deepStrictEqual(
            events.map((event) => {
                return event.operation.key;
            }),
            [first, second],
            'upsertMany did not emit created events in request order'
        );
    });
});

describe('operations remove', function() {
    it('emits deleted with removed operation', async function() {
        const store = { operations: [] };
        const persistence = operationStateMemory(store);
        const bus = pubsub();
        const events = [];
        bus.stream((event) => {
            events.push(event);
        });
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const key = `del-${Math.random().toString(36).slice(2)}`;
        await persistence.upsert({
            machine: machineId,
            occurred_at: new Date('2024-06-01T12:00:00.000Z'),
            kind: 'bath',
            key,
            payload: { action: 'load', unit: 'kg' }
        });
        const ops = operations(persistence, bus);
        await ops.remove(machineId, key);
        assert.strictEqual(events[0].type, 'deleted', 'remove cannot skip deleted bus event');
    });
});

describe('operations listForMachine', function() {
    it('merges persistence and injectable kind sources sorted by occurred_at', async function() {
        const store = { operations: [] };
        const persistence = operationStateMemory(store);
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const chemKey = `chem-${Math.random()}`;
        await persistence.upsert({
            machine: machineId,
            occurred_at: new Date('2024-06-01T12:00:00.000Z'),
            kind: 'chem',
            key: chemKey,
            payload: { lot: 'β' }
        });
        const stamp = `temp-${Math.random()}`;
        const ops = operations(persistence, pubsub(), {
            temp: {
                list(id) {
                    return Promise.resolve([
                        {
                            machine: id,
                            occurred_at: new Date('2024-06-01T11:00:00.000Z'),
                            kind: 'temp',
                            key: `${stamp}-early`,
                            payload: { temperature: 1483.5 }
                        },
                        {
                            machine: id,
                            occurred_at: new Date('2024-06-01T13:00:00.000Z'),
                            kind: 'temp',
                            key: `${stamp}-late`,
                            payload: { temperature: 1550.25 }
                        }
                    ]);
                }
            }
        });
        const rows = await ops.listForMachine(machineId, ['chem', 'temp'], {
            from: new Date('2024-06-01T00:00:00.000Z'),
            to: new Date('2024-06-02T00:00:00.000Z')
        });
        assert.deepStrictEqual(
            rows.map((row) => {
                return row.kind;
            }),
            ['temp', 'chem', 'temp'],
            'merged kinds must not stay unsorted by occurred_at'
        );
    });

    it('defaults kinds to injectable source keys when kinds are omitted', async function() {
        const store = { operations: [] };
        const persistence = operationStateMemory(store);
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const key = `temp-only-${Math.random()}`;
        const ops = operations(persistence, pubsub(), {
            temp: {
                list(id) {
                    return Promise.resolve([
                        {
                            machine: id,
                            occurred_at: new Date('2024-06-01T09:30:00.000Z'),
                            kind: 'temp',
                            key,
                            payload: { temperature: 1510 }
                        }
                    ]);
                }
            }
        });
        const rows = await ops.listForMachine(machineId, undefined, {});
        assert.strictEqual(rows[0].key, key, 'omitted kinds must not ignore injectable sources');
    });

    it('accepts a single kind string for persistence-backed reads', async function() {
        const store = { operations: [] };
        const persistence = operationStateMemory(store);
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const key = `chem-${Math.random()}`;
        await persistence.upsert({
            machine: machineId,
            occurred_at: new Date('2024-06-01T12:00:00.000Z'),
            kind: 'chem',
            key,
            payload: { lot: 'γ' }
        });
        const ops = operations(persistence, pubsub());
        const rows = await ops.listForMachine(machineId, 'chem', {});
        assert.strictEqual(rows[0].key, key, 'string kind must not fail to load persistence rows');
    });
});

describe('operations latestForMachine', function() {
    it('returns the newest persistence row at or before to', async function() {
        const store = { operations: [] };
        const persistence = operationStateMemory(store);
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const earlyKey = `early-${Math.random().toString(36).slice(2)}`;
        const lateKey = `late-${Math.random().toString(36).slice(2)}`;
        await persistence.upsert({
            machine: machineId,
            occurred_at: new Date('2024-06-01T10:00:00.000Z'),
            kind: 'chem',
            key: earlyKey,
            payload: { lot: 'α' }
        });
        await persistence.upsert({
            machine: machineId,
            occurred_at: new Date('2024-06-01T12:00:00.000Z'),
            kind: 'chem',
            key: lateKey,
            payload: { lot: 'β' }
        });
        const ops = operations(persistence, pubsub());
        const latest = await ops.latestForMachine(machineId, 'chem', {
            to: new Date('2024-06-01T11:00:00.000Z')
        });
        assert.strictEqual(latest.key, earlyKey, 'latestForMachine did not pick the newest row within bound');
    });
});
