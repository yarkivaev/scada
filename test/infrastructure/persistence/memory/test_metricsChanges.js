import assert from 'assert';
import metricsStateMemory from '../../../../src/infrastructure/persistence/memory/metrics.js';

describe('metricsStateMemory changesForTopic', function() {
    it('pins the held level at the window start and drops heartbeats', function() {
        const topic = `flag/${Math.random()}`;
        const origin = Date.parse('2026-09-30T04:00:00.000Z');
        const store = {
            metrics: [
                { topic, ts: new Date(origin - 1500), value: 0 },
                { topic, ts: new Date(origin + 1000), value: 0 },
                { topic, ts: new Date(origin + 2000), value: 1 },
                { topic, ts: new Date(origin + 3000), value: 1 }
            ]
        };
        const rows = metricsStateMemory(store).changesForTopic(
            topic,
            new Date(origin).toISOString(),
            new Date(origin + 4000).toISOString()
        );
        assert.deepStrictEqual(
            rows.map((row) => {
                return { ts: new Date(row.ts).getTime(), value: row.value };
            }),
            [
                { ts: origin, value: 0 },
                { ts: origin + 2000, value: 1 }
            ],
            'changes kept heartbeat repeats or lost the start level'
        );
    });
});
