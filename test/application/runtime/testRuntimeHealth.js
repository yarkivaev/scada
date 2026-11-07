import assert from 'node:assert/strict';
import runtimeHealth from '../../../src/application/runtime/runtimeHealth.js';

describe('collector health', () => {
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
