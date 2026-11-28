import assert from 'node:assert/strict';
import deliveryQueue from '../../../src/application/runtime/deliveryQueue.js';
import runtimeHealth from '../../../src/application/runtime/runtimeHealth.js';
import spoolSurface from '../../../src/application/runtime/spoolSurface.js';

async function healthWithQueue() {
    const queue = deliveryQueue({ maxBytes: 10000, factory() { throw new Error('offline'); } });
    await queue.open();
    const health = await runtimeHealth({ status() { return { initialized: true, fatal: false, stopping: false, tasks: [] }; } }, {
        port: 0, handle: spoolSurface(queue, null)
    });
    return {
        queue,
        get(path) { return fetch(`http://127.0.0.1:${health.port}${path}`); },
        async close() { await health.stop(); await queue.close(); }
    };
}

describe('collector health checkpoint', function() {
    it('serves checkpoint routes from the current queue on the health port', async function() {
        const first = await healthWithQueue();
        try {
            await first.queue.accept({
                eventId: 'one', routingKey: 'COOLING.device.GET.T01.VALUE', body: Buffer.from(JSON.stringify({ ts: 12000, value: 20 }))
            }, [{ id: 'broker', type: 'amqp' }]);
            const response = await first.get('/v1/checkpoint/pending-segments');
            assert.equal(response.status, 200);
            assert.deepEqual(await response.json(), { items: [] });
            const cursor = await first.get('/v1/checkpoint/replay-cursor?machineId=device');
            assert.equal(cursor.status, 200);
            assert.deepEqual(await cursor.json(), { machineId: 'device', cursor: 12 });
        } finally { await first.close(); }

        const restarted = await healthWithQueue();
        try {
            const cursor = await restarted.get('/v1/checkpoint/replay-cursor?machineId=device');
            assert.equal(cursor.status, 200);
            assert.deepEqual(await cursor.json(), { machineId: 'device', cursor: 0 });
        } finally { await restarted.close(); }
    });
});
