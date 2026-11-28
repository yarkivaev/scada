import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import runCollector from '../../../src/application/runtime/runCollector.js';

async function freePort() {
    const server = createServer();
    await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve); });
    const { port } = server.address();
    await new Promise(resolve => { server.close(resolve); });
    return port;
}
function registry(events = []) {
    return new Map([['test', { validate() {}, resources() { return []; }, create() {
        return { start() { events.push('reading'); }, stop() {} };
    } }]]);
}

describe('collector recovery startup', function() {
    it('opens the process-local startup probe only after recovery and closes it on shutdown', async function() {
        let entered; let release;
        const opening = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        const healthPort = await freePort();
        const startupPort = await freePort();
        const url = `http://127.0.0.1:${startupPort}/startup`;
        const startup = runCollector({ registry: registry(), signals: false, argv: [],
            env: { COLLECTOR_HEALTH_PORT: String(healthPort), COLLECTOR_STARTUP_PORT: String(startupPort), COLLECTOR_MANIFEST: '{"assignments":[]}' },
            deliveryQueue: { async open() { entered(); await gate; }, async drain() {}, async close() {}, status() { return { ready: true }; } } });
        try {
            await opening;
            assert.equal((await fetch(`http://127.0.0.1:${healthPort}/live`)).status, 200);
            assert.equal((await fetch(`http://127.0.0.1:${healthPort}/ready`)).status, 503);
            await assert.rejects(fetch(url));
            release();
            await startup;
            const probe = await fetch(url);
            assert.equal(probe.status, 200);
            assert.deepEqual(await probe.json(), { localRecoveryComplete: true });
            assert.equal((await fetch(`http://127.0.0.1:${healthPort}/ready`)).status, 200);
        } finally { release(); await (await startup).stop(); }
        await assert.rejects(fetch(url));
    });

    it('stops recovered readers when the startup listener cannot bind', async function () {
        const blocker = createServer();
        await new Promise(resolve => { blocker.listen(0, '127.0.0.1', resolve); });
        const events = [];
        const adapters = registry(events);
        adapters.get('test').create = () => {
            return { start() { events.push('reading'); }, stop() { events.push('stopped'); } };
        };
        let collector;
        try {
            await assert.rejects(async () => {
                collector = await runCollector({ registry: adapters, signals: false, argv: [], env: {
                    COLLECTOR_STARTUP_PORT: String(blocker.address().port),
                    COLLECTOR_MANIFEST: JSON.stringify({ assignments: [
                        { taskId: 'sensor', generation: 1, specVersion: 1, spec: { adapter: 'test' } }
                    ] })
                } });
            }, { code: 'EADDRINUSE' });
            assert.deepEqual(events, ['reading', 'stopped']);
        } finally {
            await collector?.stop();
            await new Promise(resolve => { blocker.close(resolve); });
        }
    });

    it('bounds stalled local recovery and prevents a late completion from starting readers after shutdown', async function() {
        let entered; let release;
        const opening = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        const events = [];
        const startup = runCollector({ registry: registry(events), signals: false, argv: [], env: {
            COLLECTOR_RECOVERY_TIMEOUT_MS: '20', COLLECTOR_MANIFEST: JSON.stringify({ assignments: [
                { taskId: 'sensor', generation: 1, specVersion: 1, spec: { adapter: 'test' } }
            ] })
        }, deliveryQueue: { async open() { entered(); await gate; }, async close() {}, async drain() {} } });
        const outcome = startup.then(() => {return null}, error => {return error});
        try {
            await opening;
            const expired = await Promise.race([outcome, new Promise(resolve => { setTimeout(() => {return resolve(null)}, 200); })]);
            assert.match(expired?.message ?? '', /deadline|timed out/iu);
        } finally { release(); await outcome; }
        await new Promise(resolve => { setImmediate(resolve); });
        assert.deepEqual(events, []);
    });

    it('starts local health while waiting for its first controller assignment', async function() {
        let observed; let reported;
        const assignmentRequested = new Promise(resolve => { observed = resolve; });
        const assignmentReported = new Promise(resolve => { reported = resolve; });
        const snapshot = { generation: 1, assignments: [
            { taskId: 'sensor', generation: 1, specVersion: 1, spec: { adapter: 'test' } }
        ] };
        const range = JSON.stringify({ kvs: [{ value: Buffer.from(JSON.stringify(snapshot)).toString('base64') }] });
        const gateway = createServer((input, response) => {
            input.resume();
            if (input.url === '/v3/kv/range') {
                observed(response);
                return;
            }
            input.on('end', () => { response.end('{}'); reported(); });
        });
        await new Promise(resolve => { gateway.listen(0, '127.0.0.1', resolve); });
        const port = await freePort();
        const health = `http://127.0.0.1:${port}`;
        const events = [];
        const startup = runCollector({ registry: registry(events), signals: false, argv: [], env: {
            COLLECTOR_NODE_ID: 'a', COLLECTOR_HEALTH_PORT: String(port),
            COLLECTOR_CONTROL_ENDPOINTS: `http://127.0.0.1:${gateway.address().port}`
        } });
        let pending;
        try {
            await startup;
            pending = await assignmentRequested;
            assert.deepEqual(events, []);
            assert.equal((await fetch(`${health}/live`)).status, 200);
            assert.equal((await fetch(`${health}/ready`)).status, 503);

            pending.end(range);
            await assignmentReported;
            assert.deepEqual(events, ['reading']);
            assert.equal((await fetch(`${health}/ready`)).status, 200);
        } finally {
            if (pending && !pending.writableEnded) { pending.end(range); }
            gateway.closeAllConnections();
            await (await startup.catch(() => { return null; }))?.stop();
            await new Promise(resolve => { gateway.close(resolve); });
        }
    });
});
