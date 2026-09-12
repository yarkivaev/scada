import assert from 'assert';
import operationStateMemory from '../../../src/infrastructure/persistence/memory/operations.js';
import operationSyncSink from '../../../src/infrastructure/sync/operationSyncSink.js';

describe('operationSyncSink', function() {
    it('forwards decoded record to operations upsert', async function() {
        const upserts = [];
        const operations = {
            upsert(item) {
                upserts.push(item);
                return Promise.resolve();
            }
        };
        const sink = operationSyncSink(operations);
        const key = `nb-${Math.random()}`;
        await sink.accept({
            machine: 'm1',
            occurred_at: new Date('2024-06-01T10:00:00.000Z'),
            kind: 'sample',
            key,
            payload: { carbon: 0.1 }
        });
        assert.strictEqual(upserts[0].key, key, 'sink must pass storage key to upsert');
    });

    it('forwards deleted record to operations drop', async function() {
        const drops = [];
        const operations = {
            upsert() {
                return Promise.resolve();
            },
            drop(machineId, key) {
                drops.push({ machineId, key });
                return Promise.resolve();
            }
        };
        const sink = operationSyncSink(operations);
        const key = `rm-${Math.random().toString(36).slice(2)}`;
        await sink.remove({
            machine: 'm3',
            occurred_at: new Date('2024-06-01T11:00:00.000Z'),
            kind: 'load',
            key
        });
        assert.deepStrictEqual(drops[0], {
            machineId: 'm3',
            key
        }, 'sink remove must call operations.drop with machine and key');
    });

    it('treats remove of unknown key as success', async function() {
        const store = { operations: [] };
        const sink = operationSyncSink(operationStateMemory(store));
        const key = `miss-${Math.random().toString(36).slice(2)}`;
        await assert.doesNotReject(
            () => {
                return sink.remove({
                    machine: 'icht3',
                    occurred_at: new Date('2026-09-10T10:29:19.000Z'),
                    kind: 'sample',
                    key
                });
            },
            'federated delete cannot fail when row is already absent'
        );
    });
});
