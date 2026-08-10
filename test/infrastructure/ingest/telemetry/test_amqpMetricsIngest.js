import assert from 'assert';
import {
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
        assert.deepStrictEqual(seen, [device], 'onSeen did not receive the telemetry stream name');
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
