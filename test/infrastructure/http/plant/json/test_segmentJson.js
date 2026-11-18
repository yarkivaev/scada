import assert from 'assert';
import segmentJson, { segmentItems } from '../../../../../src/infrastructure/http/plant/json/segmentJson.js';

describe('segmentJson', function() {
    it('paints now only on the last duration-zero row', function() {
        const origin = 1_701_500_000_000 + Math.floor(Math.random() * 1e8);
        const staleStart = new Date(origin);
        const staleEnd = new Date(origin + 1000);
        const openStart = new Date(origin + 60_000);
        const openEnd = new Date(origin + 61_000);
        const now = new Date(origin + 3_600_000);
        const items = segmentItems([
            {
                name: 'on',
                start_time: staleStart,
                end_time: staleEnd,
                duration: 0
            },
            {
                name: 'on',
                start_time: openStart,
                end_time: openEnd,
                duration: 0
            }
        ], () => {
            return now;
        });
        assert.deepStrictEqual(
            [items[0].end, items[1].end],
            [staleEnd.toISOString(), now.toISOString()],
            'GET painted every duration-zero end as now'
        );
    });

    it('keeps a closed end on a duration-zero row when it is not last', function() {
        const origin = 1_701_600_000_000 + Math.floor(Math.random() * 1e8);
        const start = new Date(origin);
        const end = new Date(origin + 3000);
        const mapped = segmentJson({
            name: 'on',
            start_time: start,
            end_time: end,
            duration: 0
        });
        assert.strictEqual(mapped.end, end.toISOString(), 'a stale open row was painted as live');
    });

    it('closes a duration-zero row that is not the last pending', function() {
        const origin = 1_701_650_000_000 + Math.floor(Math.random() * 1e8);
        const staleStart = new Date(origin);
        const staleEnd = new Date(origin + 4000);
        const items = segmentItems([
            {
                name: 'on',
                start_time: staleStart,
                end_time: staleEnd,
                duration: 0
            },
            {
                name: 'on',
                start_time: new Date(origin + 60_000),
                end_time: new Date(origin + 61_000),
                duration: 0
            }
        ]);
        assert.notStrictEqual(items[0].duration, 0, 'a stale open heating stayed pending for the HMI ticker');
    });
});
