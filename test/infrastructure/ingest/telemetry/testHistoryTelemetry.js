import assert from 'node:assert/strict';
import historyTelemetry, { persistTelemetry } from '../../../../src/infrastructure/ingest/telemetry/historyTelemetry.js';
describe('durable local telemetry receiver', () => {
    it('acceptance waits for PostgreSQL commit and preserves original observation time', async () => {
        let commit;
        let record;
        let accepted = false;
        const result = persistTelemetry({ write(rows) { [record] = rows; return new Promise((resolve) => { commit = resolve; }); } },
            { fields: { routingKey: 'MX210.icht-1.GET.AI1.VALUE' }, content: Buffer.from('{"ts":1700000000123,"value":42}') }).then(() => { accepted = true; });
        await new Promise((resolve) => { setImmediate(resolve); });
        assert.equal(accepted, false);
        assert.equal(record.topic, 'MX210/icht-1/GET/AI1/VALUE');
        assert.equal(record.ts, 1700000000123);
        commit(); await result; assert.equal(accepted, true);
    });
    it('does not acknowledge a database failure or silently discard invalid telemetry', async () => {
        const delivery = { fields: { routingKey: 'COOLING.icht-1.GET.AI1.VALUE' }, content: Buffer.from('{"ts":1700000000123,"value":42}') };
        await assert.rejects(persistTelemetry({ write() { return Promise.reject(new Error('PG unavailable')); } }, delivery), /PG unavailable/u);
        await assert.rejects(persistTelemetry({ write() { assert.fail('invalid telemetry must not be written'); } }, { ...delivery, content: Buffer.from('{"operation":"temp"}') }), /telemetry/u);
    });
});

it('requires explicit telemetry bindings rather than consuming unrelated exchange traffic', () => {
    assert.throws(() => { historyTelemetry({ HISTORY_AMQP_ENABLED: 'true', HISTORY_AMQP_URL: 'amqp://localhost' }, {}); }, /bindings/u);
});
