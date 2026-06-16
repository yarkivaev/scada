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
            machine: 'icht1',
            occurred_at: new Date('2024-06-01T10:00:00.000Z'),
            kind: 'chem',
            key,
            payload: { carbon: 0.1 }
        });
        assert.strictEqual(upserts[0].key, key, 'sink must pass storage key to upsert');
    });
});
