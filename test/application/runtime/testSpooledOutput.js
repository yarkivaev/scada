import assert from 'node:assert/strict';
import * as runtime from '@yarkivaev/scada/runtime';

describe('spooled AMQP output', function () {
    it('preserves the routing key and enriches JSON only when accepting records into the node queue', async function () {
        const accepted = [];
        const context = { nodeId: 'edge', taskId: 'source', signal: new AbortController().signal,
            deliveryQueue: { async accept(record, destinations) { accepted.push({ record, destinations }); } } };
        const destinations = runtime.amqpDestinations('amqp://localhost', 'observations');
        const output = runtime.spooledOutput(context, destinations);
        await output.write([{ exchange: 'observations', routingKey: 'source.value', eventId: 'original',
            body: Buffer.from('{"value":7}') }]);
        assert.equal(accepted[0].record.routingKey, 'source.value');
        assert.deepEqual(JSON.parse(accepted[0].record.body), {
            value: 7, eventId: 'original', collectorId: 'edge', taskId: 'source'
        });
        assert.deepEqual(accepted[0].destinations, [{
            id: 'observations', type: 'amqp', url: 'amqp://localhost',
            options: { exchanges: [{ name: 'observations', type: 'topic', options: { durable: true } }] }
        }]);
    });
});
