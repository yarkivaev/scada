import assert from 'node:assert/strict';
import * as core from '@yarkivaev/scada';
const replay = core.telemetryReplay;

describe('telemetry replay onto an AMQP exchange', function() {
    it('cannot drop the original integer timestamp when republishing a stored point', function() {
        assert.deepEqual(replay({
            topic: 'SENSOR/unit-1/GET/temperature/VALUE',
            ts: '2026-11-21 00:11:37.043',
            value: 12.5
        }), {
            exchange: 'scada.telemetry',
            routingKey: 'SENSOR.unit-1.GET.temperature.VALUE',
            payload: JSON.stringify({ts: Date.parse('2026-11-21T00:11:37.043Z'), value: 12.5}),
            persistent: true
        }, 'Replay published a synthesized timestamp or a transient message');
    });
});
