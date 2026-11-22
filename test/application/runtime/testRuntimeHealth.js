import assert from 'node:assert/strict';
import runtimeHealth from '../../../src/application/runtime/runtimeHealth.js';
import queuedDelivery from '../../../src/application/runtime/queuedDelivery.js';

describe('collector health', () => {
    it('fails GET /live when assigned modbus lastAccept is stale', async () => {
        const stamp = Date.now() - (12000 + Math.floor(Math.random() * 8000));
        const runtime = { status() {
            return { fatal: false, stopping: false, tasks: [{
                adapter: 'modbus', state: 'running', health: 'running', lastAccept: stamp
            }] };
        } };
        const health = await runtimeHealth(runtime, { port: 0, staleMs: 5000 });
        try {
            assert.equal((await fetch(`http://127.0.0.1:${health.port}/live`)).status, 503, 'stale assigned modbus still looked live');
        } finally { await health.stop(); }
    });
    it('does not fail GET /live when AMQP sink is not connected while spooling', async () => {
        const lastAccept = Date.now();
        const runtime = { status() {
            return { fatal: false, stopping: false, tasks: [{
                adapter: 'modbus', state: 'running', health: 'running', lastAccept
            }] };
        } };
        const health = await runtimeHealth(runtime, { port: 0, staleMs: 30000 });
        const delivery = queuedDelivery({}, null, {
            async open() {},
            async close() {},
            status() { return { ready: true, pending: 1, drainFull: true }; },
            async drain() { throw new Error('AMQP sink is not connected'); }
        });
        try {
            await delivery.open();
            await new Promise((resolve) => { setTimeout(resolve, 30); });
            assert.equal((await fetch(`http://127.0.0.1:${health.port}/live`)).status, 200, 'AMQP delay while spooling tripped liveness');
        } finally {
            await delivery.stop();
            await health.stop();
        }
    });
    it('distinguishes process liveness from readiness', async () => {
        let stopping = false;
        let fatal = false;
        const tasks = [];
        const runtime = { status() { return { fatal, stopping, budget: { bytes: 0 }, tasks }; } };
        const health = await runtimeHealth(runtime, { port: 0, host: '127.0.0.1' });
        const base = `http://127.0.0.1:${health.port}`;
        try {
            assert.equal((await fetch(`${base}/live`)).status, 200);
            assert.equal((await fetch(`${base}/ready`)).status, 200);
            tasks.push({ state: 'running', health: 'failed' });
            assert.equal((await fetch(`${base}/ready`)).status, 503);
            Object.assign(tasks[0], { health: 'running' });
            assert.equal((await fetch(`${base}/ready`)).status, 200);
            stopping = true;
            assert.equal((await fetch(`${base}/ready`)).status, 503);
            assert.equal((await fetch(`${base}/live`)).status, 200);
            fatal = true;
            assert.equal((await fetch(`${base}/live`)).status, 503);
            assert.equal((await fetch(`${base}/unknown`)).status, 404);
        } finally { await health.stop(); }
    });
});
