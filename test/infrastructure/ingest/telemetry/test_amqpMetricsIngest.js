import assert from 'assert';
import { EventEmitter } from 'node:events';
import amqpMetricsIngest, {
    acceptTelemetryDeliver,
    telemetryConsumer
} from '../../../../src/infrastructure/ingest/telemetry/amqpMetricsIngest.js';

describe('amqpMetricsIngest', function() {
    it('acceptTelemetryDeliver writes metric from amqp routing key and json body', function() {
        const suffix = Math.random().toString(36).slice(2);
        const value = Math.random() * 400;
        const accepted = [];
        const codec = {
            accept(raw) {
                accepted.push(raw);
            }
        };
        acceptTelemetryDeliver(codec, {
            routingKey: `MX210.m-1.GET.AI1.VALUE-${suffix}`
        }, Buffer.from(JSON.stringify({ value })));
        assert.strictEqual(accepted.length, 1, 'should accept one telemetry message');
        assert.strictEqual(
            accepted[0].topic,
            `MX210/m-1/GET/AI1/VALUE-${suffix}`,
            'should map routing key to metrics topic'
        );
    });

    it('telemetryConsumer acks via channel without session state', function() {
        const suffix = Math.random().toString(36).slice(2);
        const acked = [];
        const channel = {
            ack(msg) {
                acked.push(msg);
            }
        };
        const codec = { accept() {} };
        const consume = telemetryConsumer(codec, channel);
        consume({
            fields: { routingKey: `plant.m-1.${suffix}` },
            content: Buffer.from(JSON.stringify({ value: 1 }))
        });
        assert.strictEqual(acked.length, 1, 'should ack message via bound channel');
    });

    it('acceptTelemetryDeliver reports stream name to onSeen', function() {
        const device = `m-${Math.random().toString(36).slice(2)}`;
        const seen = [];
        const codec = { accept() {} };
        acceptTelemetryDeliver(
            codec,
            { routingKey: `MX210.${device}.GET.AI1.VALUE` },
            Buffer.from(JSON.stringify({ value: Math.random() * 10 })),
            (name) => {
                seen.push(name);
            }
        );
        assert.deepStrictEqual(seen, [`MX210/${device}`], 'onSeen did not receive the telemetry stream name');
    });

    it('acceptTelemetryDeliver skips onSeen when the callback is omitted', function() {
        const accepted = [];
        const codec = {
            accept(raw) {
                accepted.push(raw);
            }
        };
        acceptTelemetryDeliver(
            codec,
            { routingKey: `MX210.m-${Math.random().toString(36).slice(2)}.GET.AI2.VALUE` },
            Buffer.from(JSON.stringify({ value: 3 }))
        );
        assert.strictEqual(accepted.length, 1, 'telemetry was not accepted without onSeen');
    });
});


describe('AMQP telemetry batching capacity', function() {
    for (const [size, prefetch, expected] of [[50, 32, 32], [8, 32, 8], [undefined, 32, 32]]) {
        it(`flushes a full broker window without waiting for the timer (size=${size})`, async function() {
            const channel = new EventEmitter();
            const connection = new EventEmitter();
            const writes = [];
            const acked = [];
            let consume;
            let configuredPrefetch;
            let release;
            const blocked = new Promise((resolve) => { release = resolve; });
            Object.assign(channel, {
                assertQueue: async () => { return { queue: 'telemetry' }; },
                prefetch: async (value) => { configuredPrefetch = value; },
                consume: async (queue, callback) => { consume = callback; return { consumerTag: 'test' }; },
                ack: (message) => { acked.push(message); },
                nack: () => { assert.fail('valid telemetry must not be rejected'); },
                cancel: async () => {}, close: async () => {}
            });
            connection.createChannel = async () => { return channel; };
            connection.close = async () => {};
            const ingest = amqpMetricsIngest('amqp://test', 'telemetry', {
                async write(records) { writes.push(records); await blocked; }
            }, { size, prefetch, maxWaitMs: 100, connect: async () => { return connection; } });
            await ingest.start();
            const pending = Array.from({ length: expected }, (unused, index) => { return consume({
                fields: { routingKey: 'MX210.test.GET.AI1.VALUE' },
                properties: {}, content: Buffer.from(JSON.stringify({ ts: Date.now(), value: index }))
            }); });
            try {
                await new Promise((resolve) => { setImmediate(resolve); });
                assert.strictEqual(configuredPrefetch, prefetch);
                assert.strictEqual(writes.length, 1, 'broker window must flush before maxWaitMs');
                assert.strictEqual(writes[0].length, expected);
                assert.strictEqual(acked.length, 0, 'ACK must wait for durable sink completion');
            } finally {
                release();
                await Promise.all(pending);
                await ingest.stop();
            }
            assert.strictEqual(acked.length, expected);
        });
    }
});
