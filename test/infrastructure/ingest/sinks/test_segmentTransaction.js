import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import segmentTransaction from '../../../../src/infrastructure/ingest/sinks/segmentTransaction.js';

describe('segment transaction connection ownership', () => {
    it('destroys a connection that arrives after the acquisition deadline', async () => {
        let connected;
        const releases = [];
        const failures = [];
        const client = new EventEmitter();client.release = destroy => { releases.push(destroy); };
        const writer = segmentTransaction({ connect() { return new Promise(resolve => { connected = resolve; }); } },
            { accept() { throw new Error('late work must not start'); } }, { timeoutMs: 15, onFatal(error) { failures.push(error); } });
        await assert.rejects(writer.write([{}]), /timed out/u);
        connected(client);await delay(10);
        assert.deepEqual(releases, [true]);assert.equal(failures.length, 1);
    });
});
