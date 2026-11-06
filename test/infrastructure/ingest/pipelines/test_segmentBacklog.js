import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import stompit from 'stompit';
import segmentPipeline from '../../../../src/infrastructure/ingest/pipelines/segmentPipeline.js';

/** Drive actual pipeline/codec/SQL composition with a healthy, slower query port. */
describe('segment backlog admission', function() {
    this.timeout(15000);
    it('does not time out valid records merely waiting behind the same-machine backlog', async () => {
        const original = stompit.Channel;
        let receive;
        let acked = 0;
        let closes = 0;
        const errors = [];
        stompit.Channel = function Channel() {
            return { subscribe(_headers, callback) { receive = callback; },
                ack() { acked += 1; }, nack() {}, close() { closes += 1; } };
        };
        const pool = { async query() { await delay(5); return { rows: [], rowCount: 0 }; }, async end() {} };
        const pipeline = segmentPipeline('stomp://example.invalid', 'postgres://unused', pool,
            { size: 50, interval: 2, prefetch: 128, acceptTimeoutMs: 200, stopTimeoutMs: 5000,
                onError(error) { errors.push(error); } });
        try {
            await pipeline.start();
            for (let index = 0; index < 120; index += 1) {
                const payload = JSON.stringify({ type: 'segment', machine: 'test-machine', name: 'on',
                    start: 1700000000000 + index * 60000, end: 1700000060000 + index * 60000, duration: 60 });
                receive(null, { readString(_encoding, done) { done(null, payload); } });
            }
            for (let attempt = 0; attempt < 500; attempt += 1) {
                if (acked === 120 || closes > 0) { break; }
                // Poll the asynchronous protocol boundary with a finite deadline.
                // eslint-disable-next-line no-await-in-loop
                await delay(20);
            }
            assert.equal(closes, 0, 'healthy bounded writes were mistaken for a hung acceptance');
            assert.equal(acked, 120, 'all committed segments must be acknowledged');
            assert.deepEqual(errors, []);
        } finally {
            await pipeline.stop().catch(() => {});
            // Dependency-boundary stub only; no network or production database.
            // eslint-disable-next-line require-atomic-updates
            stompit.Channel = original;
        }
    });
    it('fences a hung timer-flushed heartbeat even without another delivery', async () => {
        const original = stompit.Channel;
        let receive;
        let writes = false;
        let complete;
        let acked = 0;
        let closes = 0;
        const fatals = [];
        stompit.Channel = function Channel() {
            return { subscribe(_headers, callback) { receive = callback; },
                ack() { acked += 1; }, nack() {}, close() { closes += 1; } };
        };
        const pool = { query() {
            return writes ? new Promise(resolve => { complete = resolve; }) : Promise.resolve({ rows: [], rowCount: 0 });
        }, async end() {} };
        const pipeline = segmentPipeline('stomp://example.invalid', 'postgres://unused', pool,
            { size: 50, interval: .01, acceptTimeoutMs: 20, onError() {},
                onFatal(error) { fatals.push(error); } });
        try {
            await pipeline.start();
            writes = true;
            const payload = JSON.stringify({ type: 'segment', machine: 'test-machine', name: 'on',
                start: 1700000000000, end: 1700000060000, duration: 0 });
            receive(null, { readString(_encoding, done) { done(null, payload); } });
            await delay(150);
            assert.equal(fatals.length, 1);
            assert.equal(closes, 1);
            assert.equal(pipeline.health().state, 'failed');
            writes = false;
            complete?.({ rows: [], rowCount: 0 });
            await delay(30);
            assert.equal(acked, 0, 'late timer writes must not ACK after a fatal fence');
        } finally {
            await pipeline.stop().catch(() => {});
            // eslint-disable-next-line require-atomic-updates
            stompit.Channel = original;
        }
    });

});
