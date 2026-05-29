import assert from 'assert';
import deliverToMqttRecord from '../../../../src/infrastructure/ingest/telemetry/deliverToMqttRecord.js';

describe('deliverToMqttRecord', function() {
    it('maps routing key to mqtt topic preserving body', function() {
        const suffix = Math.random().toString(36).slice(2);
        const topic = `MX210/icht-1/GET/AI1/VALUE-${suffix}`;
        const body = Buffer.from(JSON.stringify({ value: Math.random() }));
        const record = deliverToMqttRecord({ routingKey: topic }, body);
        assert.strictEqual(record.topic, topic, 'should use routing key as mqtt topic');
        assert.strictEqual(record.payload, body, 'should pass body unchanged');
    });
    it('converts amqp dotted routing key to mqtt slash topic', function() {
        const suffix = Math.random().toString(36).slice(2);
        const record = deliverToMqttRecord(
            { routingKey: `MX210.icht-1.GET.AI1.VALUE-${suffix}` },
            Buffer.from('1')
        );
        assert.strictEqual(
            record.topic,
            `MX210/icht-1/GET/AI1/VALUE-${suffix}`,
            'should map amqp dots to mqtt slashes'
        );
    });
});
