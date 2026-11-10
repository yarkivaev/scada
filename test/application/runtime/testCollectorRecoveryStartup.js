import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
    it('serves liveness while scanning the spool but keeps readiness false until local recovery', async function() {
        let entered; let release;
        const opening = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        const port = await freePort();
        const startup = runCollector({ registry: registry(), signals: false, argv: [],
            env: { COLLECTOR_HEALTH_PORT: String(port), COLLECTOR_MANIFEST: '{"assignments":[]}' },
            deliveryQueue: { async open() { entered(); await gate; }, async drain() {}, async close() {}, status() { return { ready: true }; } } });
        try {
            await opening;
            assert.equal((await fetch(`http://127.0.0.1:${port}/live`)).status, 200);
            assert.equal((await fetch(`http://127.0.0.1:${port}/ready`)).status, 503);
            release();
            await startup;
            assert.equal((await fetch(`http://127.0.0.1:${port}/ready`)).status, 200);
        } finally { release(); await (await startup).stop(); }
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

    for (const cached of [true, false]) {
        it(`does not wait for quorum before completing local recovery (cached assignment=${cached})`, async function() {
            const directory = await mkdtemp(path.join(tmpdir(), 'collector-recovery-'));
            const file = path.join(directory, 'assignment.json');
            if (cached) { await writeFile(file, JSON.stringify({ generation: 1, assignments: [
                { taskId: 'sensor', generation: 1, specVersion: 1, spec: { adapter: 'test' } }
            ] })); }
            let observed; let paused = true; const held = [];
            const request = new Promise(resolve => { observed = resolve; });
            const body = JSON.stringify({ kvs: [], succeeded: true, header: { revision: '1' } });
            const gateway = createServer((input, response) => {
                input.resume();
                if (paused) { held.push(response); observed(); }
                else { response.end(body); }
            });
            await new Promise(resolve => { gateway.listen(0, '127.0.0.1', resolve); });
            const port = await freePort();
            const events = [];
            let started = false;
            const startup = runCollector({ registry: registry(events), signals: false, argv: [], env: {
                COLLECTOR_NODE_ID: 'a', COLLECTOR_ASSIGNMENT_FILE: file, COLLECTOR_HEALTH_PORT: String(port),
                COLLECTOR_CONTROL_ENDPOINTS: `http://127.0.0.1:${gateway.address().port}`
            } }).then(collector => { started = true; return collector; });
            try {
                await request;
                assert.equal(started, true, 'The first control request must not block cached collection or health startup');
                assert.equal(events.includes('reading'), cached);
                assert.equal((await fetch(`http://127.0.0.1:${port}/live`)).status, 200);
                assert.equal((await fetch(`http://127.0.0.1:${port}/ready`)).status, cached ? 200 : 503);
            } finally {
                paused = false;
                held.forEach(response => { response.end(body); });
                await (await startup).stop();
                gateway.closeAllConnections();
                await new Promise(resolve => { gateway.close(resolve); });
                await rm(directory, { recursive: true, force: true });
            }
        });
    }
});
