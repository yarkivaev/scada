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
            machine: 'icht1',
            occurred_at: new Date(),
            kind: 'chem',
            key,
            payload: { lot: 'α' }
        });
        assert.strictEqual(events[0].type, 'created', 'new row must emit created');
    });
});
