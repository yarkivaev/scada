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
        assert.deepEqual(releases, [true]);assert.equal(failures.length, 0);
    });
    it('does not treat a timed-out batch as fatal', async () => {
        const failures = [];
        const client = new EventEmitter();
        client.query = async () => { await delay(40);return { rows: [] }; };
        client.release = () => {};
        const writer = segmentTransaction({ connect() { return client; } },
            { accept() { return Promise.resolve(); } },
            { timeoutMs: 8, onFatal(error) { failures.push(error); } });
        await assert.rejects(writer.write([{ machine: `печь-${Math.random()}` }]), /timed out/u);
        assert.equal(failures.length, 0, 'a timed-out batch still killed the sink');
    });
    it('still accepts a later batch after a timeout', async () => {
        const failures = [];
        let connects = 0;
        const writer = segmentTransaction({
            connect() {
                connects += 1;
                const client = new EventEmitter();
                client.query = async () => {
                    if (connects === 1) { await delay(40); }
                    return { rows: [] };
                };
                client.release = () => {};
                return client;
            }
        }, { accept() { return Promise.resolve(); } },
        { timeoutMs: 8, onFatal(error) { failures.push(error); } });
        await assert.rejects(writer.write([{ machine: `печь-${Math.random()}` }]), /timed out/u);
        await writer.write([{ machine: `ковш-${Math.random()}` }]);
        assert.equal(failures.length === 0 && connects === 2, true,
            'a later batch stayed blocked after a timeout');
    });
    it('hands a segment batch to acceptMany in one call', async function() {
        const batches = [];
        const client = new EventEmitter();
        client.query = async () => { return { rows: [] }; };
        client.release = () => {};
        const writer = segmentTransaction({ connect() { return client; } }, {
            acceptMany(records) { batches.push(records.length);return Promise.resolve(); },
            accept() { throw new Error('per-record accept must not run'); }
        }, { timeoutMs: 1000 });
        await writer.write([
            { type: 'segment', machine: `печь-${Math.random()}` },
            { type: 'segment', machine: `ковш-${Math.random()}` }
        ]);
        assert.deepEqual(batches, [2], 'the transaction still folded each record separately');
    });
});
