import assert from 'assert';
import { relayConsumer } from '../../../../src/infrastructure/ingest/telemetry/amqpMqttRelay.js';

describe('amqpMqttRelay', function() {
    it('relayConsumer acks via channel without session state', function() {
        const suffix = Math.random().toString(36).slice(2);
        const written = [];
        const acked = [];
        const sink = {
            write(records) {
                written.push(records);
            }
        };
        const channel = {
            ack(msg) {
                acked.push(msg);
            }
        };
        const consume = relayConsumer(sink, channel);
        consume({
            fields: { routingKey: `plant.m-2.${suffix}` },
            content: Buffer.from('42')
        });
        assert.strictEqual(acked.length, 1, 'should ack message via bound channel');
    });
});
