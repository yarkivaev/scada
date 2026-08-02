import assert from 'assert';
import operationStateMemory from '../../../src/infrastructure/persistence/memory/operations.js';
import {
    acceptOperationDeliver,
    operationConsumer
} from '../../../src/infrastructure/sync/operationSyncIngest.js';
import operationCodec from '../../../src/infrastructure/sync/operationCodec.js';
import operationSyncSink from '../../../src/infrastructure/sync/operationSyncSink.js';

describe('operationSyncConsumer deliver', function() {
    it('acceptOperationDeliver decodes json body into upsert call', async function() {
        const upserts = [];
        const operations = {
            upsert(item) {
                upserts.push(item);
                return Promise.resolve();
            }
        };
        const sink = operationSyncSink(operations);
        const codec = operationCodec(sink);
        const suffix = Math.random().toString(36).slice(2);
        const body = JSON.stringify({
            machine: 'icht1',
            occurred_at: '2024-06-01T10:00:00.000Z',
            kind: 'chem',
            external_key: `dup-${suffix}`,
            payload: { carbon: 0.1 }
        });
        await acceptOperationDeliver(codec, Buffer.from(body));
        assert.strictEqual(upserts.length, 1, 'deliver must trigger one upsert');
    });
});

describe('operationSyncConsumer ack', function() {
    it('operationConsumer acks message after successful decode', async function() {
        const acked = [];
        const channel = {
            ack(msg) {
                acked.push(msg);
            }
        };
        const codec = operationCodec({ accept() { return Promise.resolve(); } });
        const consume = operationConsumer(codec, channel);
        const msg = {
            content: Buffer.from(JSON.stringify({
                machine: 'icht1',
                occurred_at: '2024-06-01T10:00:00.000Z',
                kind: 'chem',
                external_key: `nb-${Math.random()}`,
                payload: {}
            }))
        };
        await consume(msg);
        assert.strictEqual(acked.length, 1, 'consumer must ack decoded message');
    });
});

describe('operationSyncConsumer idempotency', function() {
    it('duplicate delivery keeps single stored row', async function() {
        const store = { operations: [] };
        const operations = operationStateMemory(store);
        const sink = operationSyncSink(operations);
        const codec = operationCodec(sink);
        const suffix = Math.random().toString(36).slice(2);
        const body = JSON.stringify({
            machine: 'icht1',
            occurred_at: '2024-06-01T10:00:00.000Z',
            kind: 'chem',
            external_key: `dup-${suffix}`,
            payload: { carbon: 0.1 }
        });
        const buffer = Buffer.from(body);
        await acceptOperationDeliver(codec, buffer);
        await acceptOperationDeliver(codec, buffer);
        assert.strictEqual(store.operations.length, 1, 'duplicate event must not create second row');
    });
});

describe('operationSyncConsumer delete', function() {
    it('acceptOperationDeliver removes row for type deleted', async function() {
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
        const codec = operationCodec(sink);
        const key = `del-${Math.random().toString(36).slice(2)}`;
        const body = JSON.stringify({
            type: 'deleted',
            machine: 'icht1',
            occurred_at: '2024-06-01T10:00:00.000Z',
            kind: 'bath',
            external_key: key
        });
        await acceptOperationDeliver(codec, Buffer.from(body));
        assert.deepStrictEqual(removals[0], {
            machineId: 'icht1',
            key
        }, 'deleted deliver must call operations.remove');
    });
});
