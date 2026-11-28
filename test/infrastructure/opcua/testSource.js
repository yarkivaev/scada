import assert from 'node:assert/strict';
import net from 'node:net';
import { DataType, OPCUAServer, StatusCodes } from 'node-opcua';
import opcuaSource, { validateConnections } from '../../../src/infrastructure/opcua/source.js';
function connections(entries, publish, options) {
    return opcuaSource(entries, typeof publish === 'function' ? { accept: ({ channel, value }) => { return publish(channel, value); } } : publish, options);
}

const pause = (ms) => { return new Promise((resolve) => { setTimeout(resolve, ms); }); };
async function until(check) {
    const end = Date.now() + 12000;
    while (!check() && Date.now() < end) {
        // Poll the observable server/publication state.
        // eslint-disable-next-line no-await-in-loop
        await pause(50);
    }
    assert.ok(check(), 'condition reached before deadline');
}
async function port() {
    const socket = net.createServer();
    await new Promise((resolve) => { socket.listen(0, '127.0.0.1', resolve); });
    const number = socket.address().port;
    await new Promise((resolve) => { socket.close(resolve); });
    return number;
}
async function source(number, value) {
    const server = new OPCUAServer({ port: number, resourcePath: '/test', alternateHostname: ['localhost'] });
    await server.initialize();
    const namespace = server.engine.addressSpace.getOwnNamespace();
    const node = namespace.addVariable({ organizedBy: server.engine.addressSpace.rootFolder.objects,
        browseName: 'Signal', nodeId: 's=Signal', dataType: 'Double', value: { dataType: DataType.Double, value } });
    await server.start();
    return { server, node };
}
function config(number, device) {
    return { url: `opc.tcp://localhost:${number}/test`, publishMs: 50, heartbeatMs: 100,
        channels: [{ nodeId: 'ns=1;s=Signal', device }] };
}

describe('OPC UA connections', function () {
    this.timeout(60000);
    it('rejects invalid configuration and duplicate endpoints/nodes', function () {
        assert.throws(() => { connections([], null); });
        const entry = config(1234, 'a');
        assert.equal(validateConnections([entry])[0], entry);
        assert.throws(() => { validateConnections([{ ...entry, url: 'opc.tcp://' }]); });
        assert.throws(() => { validateConnections([{ ...entry, url: 'http://localhost:1234' }]); });
        assert.throws(() => { connections([entry, entry], () => {}); }, /duplicate/iu);
        assert.throws(() => { connections([{ ...entry, channels: [...entry.channels, ...entry.channels] }], () => {}); }, /duplicate/iu);
        assert.throws(() => { connections([{ ...entry, heartbeatMs: 0 }], () => {}); });
        assert.throws(() => { connections([entry], () => {}, { maxPending: 1.5 }); }, /integer/u);
    });
    it('isolates two endpoints, reads fresh heartbeats, recovers outage and stops cleanly', async function () {
        const firstPort = await port();
        const secondPort = await port();
        let first = await source(firstPort, 11);
        const second = await source(secondPort, 22);
        const events = [];
        let reads = 0;
        second.server.on('request', (request) => {
            if (request.schema.name === 'ReadRequest' && request.nodesToRead.some((node) => { return node.nodeId.toString() === 'ns=1;s=Signal'; })) { reads += 1; }
        });
        // Keep the usual request and session deadlines while exercising fast reconnect.
        const runtime = connections([config(firstPort, 'a'), config(secondPort, 'b')], (spec, value) => {
            events.push({ device: spec.device, value });
        }, { retryMs: 100 });
        try {
            await runtime.start();
            await runtime.start();
            await until(() => { return events.filter((event) => { return event.device === 'a'; }).length > 2 && events.some((event) => { return event.device === 'b'; }); });
            assert.equal(first.server.engine.currentSubscriptionCount, 1);
            assert.equal(second.server.engine.currentSubscriptionCount, 1);
            await until(() => { return reads > 2; });
            first.node.setValueFromSource({ dataType: DataType.Double, value: 13 });
            await until(() => { return events.some((event) => { return event.device === 'a' && event.value === 13; }); });
            first.node.setValueFromSource({ dataType: DataType.Double, value: 999 }, StatusCodes.BadOutOfService);
            await pause(250);
            assert.ok(!events.some((event) => { return event.value === 999; }));
            await first.server.shutdown(0);
            first = null;
            const before = events.length;
            await until(() => { return events.slice(before).some((event) => { return event.device === 'b' && event.value === 22; }); });
            first = await source(firstPort, 33);
            await until(() => { return events.some((event) => { return event.device === 'a' && event.value === 33; }); });
            await pause(400);
            assert.equal(first.server.engine.currentSubscriptionCount, 1);
            assert.equal(second.server.engine.currentSubscriptionCount, 1);
            assert.ok(events.every((event) => { return event.device === 'a' ? [11, 13, 33].includes(event.value) : event.value === 22; }));
            await runtime.stop();
            const stopped = events.length;
            await pause(300);
            assert.equal(events.length, stopped);
            await runtime.start();
            await until(() => { return events.length > stopped + 2; });
        } finally {
            await runtime.stop();
            await Promise.all([first?.server.shutdown(0), second.server.shutdown(0)]);
        }
    });
    it('enforces one shared pending-record budget across two real endpoints', async function () {
        const first = await source(await port(), 11);
        const second = await source(await port(), 22);
        let reserved = 0;
        let calls = 0;
        let release;
        const pending = new Promise((resolve) => { release = resolve; });
        const errors = [];
        const budget = { reserve({ bytes }) {
            assert.ok(bytes > 0);
            if (reserved) { throw new Error('Shared capacity exceeded'); }
            reserved += 1;
            return () => { reserved -= 1; };
        } };
        const runtime = opcuaSource([config(first.server.endpoints[0].port, 'a'), config(second.server.endpoints[0].port, 'b')],
            { accept() { calls += 1; return pending; } },
            { budget, deliveryTimeoutMs: 100, onError(error) { errors.push(error); } });
        try {
            await runtime.start();
            await until(() => { return first.server.engine.currentSubscriptionCount === 1 && second.server.engine.currentSubscriptionCount === 1 && errors.some((error) => { return error.message.includes('Shared capacity'); }); });
            assert.equal(calls, 1);
            await runtime.stop();
            assert.equal(reserved, 1);
            release();
            await pending;
            await pause(0);
            assert.equal(reserved, 0);
        } finally {
            release();
            await runtime.stop();
            await Promise.all([first.server.shutdown(0), second.server.shutdown(0)]);
        }
    });
    it('cancels an immediate start followed by stop', async function () {
        const number = await port();
        const available = await source(number, 42);
        const events = [];
        const runtime = connections([config(number, 'a')], (spec, value) => { events.push(value); });
        try {
            const starting = runtime.start();
            await runtime.stop();
            await starting;
            await pause(700);
            assert.equal(events.length, 0);
            assert.equal(available.server.engine.currentSubscriptionCount, 0);
        } finally {
            await runtime.stop();
            await available.server.shutdown(0);
        }
    });
    it('serializes overlapping start-stop-start against an active session', async function () {
        const number = await port();
        const available = await source(number, 42);
        const events = [];
        const runtime = connections([config(number, 'a')], (spec, value) => { events.push(value); });
        try {
            await runtime.start();
            await until(() => { return events.length > 2; });
            await Promise.all([runtime.start(), runtime.stop(), runtime.start()]);
            const before = events.length;
            await until(() => { return events.length > before + 2; });
            assert.equal(available.server.engine.currentSubscriptionCount, 1);
        } finally {
            await runtime.stop();
            await available.server.shutdown(0);
        }
    });
    it('cleans partial monitor setup before retrying', async function () {
        const number = await port();
        const available = await source(number, 42);
        const entry = config(number, 'a');
        entry.channels.push({ nodeId: 'ns=1;s=Missing', device: 'a' });
        const errors = [];
        const runtime = connections([entry], () => {}, { retryMs: 100, onError: (error) => { errors.push(error); } });
        try {
            await runtime.start();
            await until(() => { return errors.length >= 2; });
            assert.ok(available.server.engine.currentSubscriptionCount <= 1);
            await runtime.stop();
            assert.equal(available.server.engine.currentSubscriptionCount, 0);
        } finally {
            await runtime.stop();
            await available.server.shutdown(0);
        }
    });
    it('restores a silently deleted subscription while its session remains healthy', async function () {
        const number = await port();
        const available = await source(number, 42);
        const subscriptions = [];
        available.server.on('create_session', (activeSession) => {
            activeSession.on('new_subscription', (subscription) => { subscriptions.push(subscription); });
        });
        const events = [];
        const runtime = connections([config(number, 'a')], (spec, value) => { events.push(value); },
            { retryMs: 100, requestTimeoutMs: 500 });
        try {
            await runtime.start();
            await until(() => { return events.length > 2; });
            subscriptions[0].terminate();
            await until(() => { return subscriptions.length === 2; });
            assert.equal(available.server.engine.currentSubscriptionCount, 1);
            available.node.setValueFromSource({ dataType: DataType.Double, value: 43 });
            await until(() => { return events.includes(43); });
            await pause(400);
            assert.equal(subscriptions.length, 2);
        } finally {
            await runtime.stop();
            await available.server.shutdown(0);
        }
    });
    it('drains in-flight collection before stop completes', async function () {
        const number = await port();
        const available = await source(number, 42);
        let release;
        let accepted = false;
        const pending = new Promise((resolve) => { release = resolve; });
        const runtime = connections([config(number, 'a')], () => { accepted = true; return pending; });
        try {
            await runtime.start();
            await until(() => { return accepted; });
            let stopped = false;
            const stopping = runtime.stop().then(() => { stopped = true; });
            await pause(100);
            assert.equal(stopped, false);
            release();
            await stopping;
        } finally {
            release();
            await runtime.stop();
            await available.server.shutdown(0);
        }
    });
    it('bounds stop despite a hung collector and signals cancellation', async function () {
        const number = await port();
        const available = await source(number, 42);
        const signals = [];
        const runtime = opcuaSource([config(number, 'a')], { accept(record, context) {
            signals.push(context.signal);
            return new Promise(() => {});
        } }, { deliveryTimeoutMs: 150, maxPending: 1, maxPendingBytes: 1024 });
        try {
            await runtime.start();
            await until(() => { return signals.length > 0; });
            const started = Date.now();
            await runtime.stop();
            assert.ok(Date.now() - started < 1000);
            assert.equal(signals[0].aborted, true);
            assert.equal(available.server.engine.currentSubscriptionCount, 0);
        } finally {
            await runtime.stop();
            await available.server.shutdown(0);
        }
    });
    it('bounds connection attempts and cancels a silent TCP peer', async function () {
        const sockets = new Set();
        const peer = net.createServer((socket) => { sockets.add(socket); socket.on('close', () => { sockets.delete(socket); }); });
        await new Promise((resolve) => { peer.listen(0, '127.0.0.1', resolve); });
        const errors = [];
        const runtime = connections([config(peer.address().port, 'a')], () => {},
            { connectTimeoutMs: 200, requestTimeoutMs: 200, retryMs: 100, onError: (error) => { errors.push(error); } });
        try {
            await runtime.start();
            await until(() => { return errors.length > 0; });
            const started = Date.now();
            await runtime.stop();
            assert.ok(Date.now() - started < 2000);
        } finally {
            await runtime.stop();
            sockets.forEach((socket) => { socket.destroy(); });
            await new Promise((resolve) => { peer.close(resolve); });
        }
    });
    it('starts a healthy endpoint while another is initially unavailable and cancels stop', async function () {
        const unavailable = await port();
        const available = await port();
        const second = await source(available, 42);
        const events = [];
        const failures = [];
        const runtime = connections([config(unavailable, 'a'), config(available, 'b')], (spec, value) => {
            events.push([spec.device, value]);
            if (events.length === 1) { return Promise.reject(new Error('publish temporarily unavailable')); }
            return undefined;
        },
            { retryMs: 100, connectTimeoutMs: 400, requestTimeoutMs: 400, onError: (error, connection) => { failures.push({ error, connection }); } });
        try {
            await runtime.start();
            await until(() => { return events.length > 2; });
            assert.equal(failures.find(({ error }) => { return error.message === 'publish temporarily unavailable'; }).connection.url, config(available, 'b').url);
            assert.ok(events.every(([device, value]) => { return device === 'b' && value === 42; }));
            const started = Date.now();
            await runtime.stop();
            assert.ok(Date.now() - started < 3000);
        } finally {
            await runtime.stop();
            await second.server.shutdown(0);
        }
    });
});
