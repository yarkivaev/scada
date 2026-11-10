import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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


describe('durable pipeline destination secrets', function () {
    this.timeout(15000);
    it('persists references and resolves rotated credentials when replaying after restart', async function () {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'pipeline-secrets-'));
        const source = await device();
        const secrets = { get() { return 'amqp://reader:old-password@receiver'; } };
        const options = { maxBytes: 100000, factory() { throw new Error('offline'); } };
        const first = deliveryQueue(directory, options);
        const destinations = [{ id: 'owner', type: 'amqp', url: { $secret: 'RECEIVER_AMQP' } }];
        const spec = { delivery: 'spooled', url: 'mqtt://unused', sinks: destinations,
            config: { devices: `device:127.0.0.1:${source.port}`, address: 0, count: 1,
                interval: 0.05, threshold: 0, timeout: 1, size: 1,
                plans: [[{ point: 'holding:0', topic: 'COOLING/device/GET/T01/VALUE' }]] } };
        const task = pipelineAdapters().get('modbus').create(spec, {
            secrets, signal: new AbortController().signal, deliveryQueue: first, report() {} });
        let second;
        try {
            await first.open(); await task.start();
            await new Promise((resolve, reject) => {
                const deadline = Date.now() + 5000;
                function check() {
                    if (first.status().pending > 0) { resolve(); }
                    else if (Date.now() > deadline) { reject(new Error('No sample persisted')); }
                    else { setTimeout(check, 10); }
                }
                check();
            });
            await task.stop(); await first.close();
            const files = await readdir(directory, { recursive: true });
            const content = await Promise.all(files.filter(file => {return file.endsWith('.json')}).map(file => {return readFile(path.join(directory, file), 'utf8')}));
            assert(content.length > 0);
            assert(!content.join('').includes('old-password'), 'PVC must contain references, not resolved credentials');
            const received = [];
            secrets.get = () => {return 'amqp://reader:new-password@receiver'};
            second = deliveryQueue(directory, { ...options, factory(descriptor) {
                const resolved = resolveSecrets(descriptor, secrets);
                return { async write(records) { received.push({ url: resolved.url, records }); } };
            } });
            await second.open(); await second.drain();
            assert.equal(second.status().pending, 0);
            assert(received.length > 0);
            assert(received.every(item => {return item.url === 'amqp://reader:new-password@receiver'}));
        } finally {
            await task.stop(); await first.close(); await second?.close(); await source.stop();
            await rm(directory, { recursive: true, force: true });
        }
    });
});
