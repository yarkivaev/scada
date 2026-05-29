import assert from 'assert';
import { pgMetricsSensor } from '../../../../src/infrastructure/persistence/metricsSensor.js';

describe('pgMetricsSensor', function() {
    it('current reads latest value from metrics port', async function() {
        const topic = `MX210/icht-${Math.random()}/GET/AI1/VALUE`;
        const metrics = {
            async latestForTopic(key) {
                if (key !== topic) {
                    return undefined;
                }
                return { ts: new Date('2024-04-05T00:00:00.000Z'), value: 381.5 };
            },
            async rangeForTopic() {
                return [];
            },
            async pollTopic() {
                return [];
            }
        };
        const sensor = pgMetricsSensor(metrics, topic, 'U', 'V');
        const reading = await sensor.current();
        assert.strictEqual(reading.value, 381.5, 'current reading did not match metrics port value');
    });
});
