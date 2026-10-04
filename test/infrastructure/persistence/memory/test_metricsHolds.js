import assert from 'assert';
import metricsStateMemory from '../../../../src/infrastructure/persistence/memory/metrics.js';

describe('metricsStateMemory holdsForTopic', function() {
    it('splits a silent gap into two coverage holds', function() {
        const topic = `diam/${Math.random()}`;
        const origin = Date.parse('2026-10-03T13:32:37.000Z') + Math.floor(Math.random() * 900);
        const size = 700 + Math.floor(Math.random() * 4) * 100;
        const store = {
            metrics: [
                { topic, ts: new Date(origin), value: size },
                { topic, ts: new Date(origin + 1000), value: size },
                { topic, ts: new Date(origin + 9000), value: size }
            ]
        };
        const rows = metricsStateMemory(store).holdsForTopic(
            topic,
            new Date(origin).toISOString(),
            new Date(origin + 20000).toISOString(),
            3000
        );
        assert.strictEqual(rows.length, 2, 'a silent gap kept one memory hold');
    });
});
