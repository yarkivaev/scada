import assert from 'assert';
import { acceptTelemetryDeliver } from '../../../../src/infrastructure/ingest/telemetry/amqpMetricsIngest.js';

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
            routingKey: `MX210.icht-1.GET.AI1.VALUE-${suffix}`
        }, Buffer.from(JSON.stringify({ value })));
        assert.strictEqual(accepted.length, 1, 'should accept one telemetry message');
        assert.strictEqual(
            accepted[0].topic,
            `MX210/icht-1/GET/AI1/VALUE-${suffix}`,
            'should map routing key to metrics topic'
        );
    });
});
