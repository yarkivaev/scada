import assert from 'assert';
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
            kind: 'chem',
            key,
            payload: { carbon: 0.1 }
        });
        assert.strictEqual(upserts[0].key, key, 'sink must pass storage key to upsert');
    });

    it('forwards deleted record to operations remove', async function() {
        const removals = [];
        const operations = {
            upsert() {
                return Promise.resolve();
            },
            remove(machineId, key) {
                removals.push({ machineId, key });
                return Promise.resolve({
                    machine: machineId,
                    key,
                    kind: 'bath',
                    occurred_at: new Date('2024-06-01T10:00:00.000Z'),
                    payload: {}
                });
            }
        };
        const sink = operationSyncSink(operations);
        const key = `rm-${Math.random().toString(36).slice(2)}`;
        await sink.remove({
            machine: 'm3',
            occurred_at: new Date('2024-06-01T11:00:00.000Z'),
            kind: 'bath',
            key
        });
        assert.deepStrictEqual(removals[0], {
            machineId: 'm3',
            key
        }, 'sink remove must call operations.remove with machine and key');
    });
});
