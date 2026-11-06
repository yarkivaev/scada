import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import stompit from 'stompit';
import segmentPipeline from '../../../../src/infrastructure/ingest/pipelines/segmentPipeline.js';

describe('segment transaction batches', () => {
    it('persists two records with one commit and acknowledges neither before that commit', async () => {
        const original = stompit.Channel;
        let receive;
        let commit;
        const commands = [];
        const acknowledged = [];
        stompit.Channel = function Channel() {
            return { subscribe(_headers, callback) { receive = callback; },
                ack(frame) { acknowledged.push(frame.id); }, nack() {}, close() {} };
        };
        const client = { async query(sql) {
            commands.push(sql);
            if (sql === 'COMMIT') { await new Promise(resolve => { commit = resolve; }); }
            return { rows: [], rowCount: 0 };
        }, release() {} };
        const pool = { async query() { return { rows: [], rowCount: 0 }; },
            async connect() { return client; }, async end() {} };
        const pipeline = segmentPipeline('stomp://fixture', 'postgres://fixture', pool, {
            prefetch: 8, acceptTimeoutMs: 1000, onError() {},
            transactions: { enabled: true, maxMessages: 2, maxBytes: 4096, maxWaitMs: 100,
                completedSegments: 0, concurrency: 1, timeoutMs: 1000 }
        });
        try {
            await pipeline.start();
            for (const index of [0, 1]) {
                const payload = JSON.stringify({ type: 'segment', machine: 'fixture', name: index ? 'off' : 'on',
                    start: 1700000000000 + index * 60000, end: 1700000060000 + index * 60000, duration: 60 });
                receive(null, { id: index, readString(_encoding, done) { done(null, payload); } });
            }
            await delay(30);
            assert.deepEqual(acknowledged, [], 'messages must stay in RabbitMQ until durable commit');
            assert.equal(commands.filter(sql => { return sql === 'BEGIN'; }).length, 1);
            assert.equal(commands.filter(sql => { return sql === 'COMMIT'; }).length, 1);
            commit();
            await delay(20);
            assert.deepEqual(acknowledged, [0, 1]);
        } finally {
            commit?.();await pipeline.stop().catch(() => {});
            // eslint-disable-next-line require-atomic-updates
            stompit.Channel = original;
        }
    });
    it('still closes transport and pool when the silence watcher cannot drain', async function() {
        this.timeout(10000);
        const original = stompit.Channel;let calls = 0;let release;let closed = 0;let ended = 0;
        stompit.Channel = function Channel() { return { subscribe() {}, close() { closed += 1; } }; };
        const pool = { query(sql) {
            if (sql.includes('SET duration = GREATEST')) {
                calls += 1;
                if (calls > 1) { return new Promise(resolve => { release = resolve; }); }
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
        }, async end() { ended += 1; } };
        const pipeline = segmentPipeline('stomp://fixture', 'postgres://fixture', pool, { poll: .001, stopTimeoutMs: 20, onError() {} });
        try {
            await pipeline.start();await delay(10);
            await assert.rejects(pipeline.stop());
            assert.equal(closed, 1);assert.equal(ended, 1);
        } finally {
            release?.({ rows: [], rowCount: 0 });await pipeline.stop().catch(() => {});
            // eslint-disable-next-line require-atomic-updates
            stompit.Channel = original;
        }
    });

});
