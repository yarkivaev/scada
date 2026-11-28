import assert from 'node:assert/strict';
import net from 'node:net';
import pipelineAdapters from '../../../src/application/runtime/pipelineAdapters.js';
import deliveryQueue from '../../../src/application/runtime/deliveryQueue.js';
import resolveSecrets from '../../../src/application/runtime/resolveSecrets.js';

async function device() {
    const sockets = new Set();
    let value = 20;
    const server = net.createServer(socket => {
        sockets.add(socket); socket.on('close', () => { sockets.delete(socket); }); socket.on('error', () => {});
        let pending = Buffer.alloc(0);
        socket.on('data', chunk => {
            pending = Buffer.concat([pending, chunk]);
            while (pending.length >= 6 && pending.length >= 6 + pending.readUInt16BE(4)) {
                const request = pending.subarray(0, 6 + pending.readUInt16BE(4)); pending = pending.subarray(request.length);
                const count = request.readUInt16BE(10);
                const reply = Buffer.alloc(9 + count * 2); request.copy(reply, 0, 0, 7); reply.writeUInt16BE(3 + count * 2, 4);
                reply[7] = 3; reply[8] = count * 2;
                for (let index = 0; index < count; index += 1) { reply.writeUInt16BE(value, 9 + index * 2); }
                socket.write(reply);
            }
        });
    });
    await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve); });
    return { port: server.address().port, sockets, next() { value = 30; }, async stop() {
        for (const socket of sockets) { socket.destroy(); }
        await new Promise(resolve => { server.close(resolve); });
    } };
}


describe('queued pipeline destination secrets', function () {
    this.timeout(15000);
    it('retains secret references and resolves rotated credentials when retrying queued samples', async function () {
        const source = await device();
        let credential = 'amqp://reader:old-password@receiver';
        const secrets = { get() { return credential; } };
        let online = false;
        const received = [];
        const queue = deliveryQueue({ maxBytes: 100000, failureCooldownMs: 0, factory(descriptor) {
            const { url } = resolveSecrets(descriptor, secrets);
            if (!online) { throw new Error('offline'); }
            return { async write(records) { received.push({ url, records }); } };
        } });
        const destinations = [{ id: 'owner', type: 'amqp', url: { $secret: 'RECEIVER_AMQP' } }];
        const spec = { delivery: 'spooled', url: 'mqtt://unused', sinks: destinations,
            config: { devices: `device:127.0.0.1:${source.port}`, address: 0, count: 1,
                interval: 0.05, threshold: 0, timeout: 1, size: 1,
                plans: [[{ point: 'holding:0', topic: 'COOLING/device/GET/T01/VALUE' }]] } };
        const task = pipelineAdapters().get('modbus').create(spec, {
            secrets, signal: new AbortController().signal, deliveryQueue: queue, report() {} });
        try {
            await queue.open();
            await task.start();
            await new Promise((resolve, reject) => {
                const deadline = Date.now() + 5000;
                function check() {
                    if (queue.status().pending > 0) { resolve(); }
                    else if (Date.now() > deadline) { reject(new Error('No sample admitted')); }
                    else { setTimeout(check, 10); }
                }
                check();
            });
            await task.stop();
            const pending = await queue.peek();
            assert(pending.length > 0);
            assert(pending.every(({ event }) => { return event.destinations[0].url.$secret === 'RECEIVER_AMQP'; }));
            assert(!JSON.stringify(pending).includes('old-password'));
            assert((await queue.drain()).failed > 0);

            credential = 'amqp://reader:new-password@receiver';
            online = true;
            await queue.drain();
            assert.equal(queue.status().pending, 0);
            assert(received.length > 0);
            assert(received.every(item => { return item.url === credential; }));
        } finally {
            await task.stop();
            await queue.close();
            await source.stop();
        }
    });
});
