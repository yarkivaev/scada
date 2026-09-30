import assert from 'assert';
import metricsStateMemory from '../../../../src/infrastructure/persistence/memory/metrics.js';

describe('metricsStateMemory risesForTopic', function() {
    it('returns prefix counts for in-window 0 to 1 edges', function() {
        const topic = `flag/${Math.random()}`;
        const origin = Date.parse('2026-09-30T00:00:00.000Z');
        const store = {
            metrics: [
                { topic, ts: new Date(origin - 2000), value: 0 },
                { topic, ts: new Date(origin + 400), value: 1 },
                { topic, ts: new Date(origin + 800), value: 1 },
                { topic, ts: new Date(origin + 5000), value: 0 },
                { topic, ts: new Date(origin + 5400), value: 1 }
            ]
        };
        const prefixes = metricsStateMemory(store).risesForTopic(
            topic,
            new Date(origin).toISOString(),
            new Date(origin + 10_000).toISOString()
        );
        assert.deepStrictEqual(
            prefixes.map((row) => {
                return row.value;
            }),
            [1, 2],
            'in-window rises did not become a prefix series'
        );
    });
});
