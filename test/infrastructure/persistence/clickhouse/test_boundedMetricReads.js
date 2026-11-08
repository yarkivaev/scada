import assert from 'node:assert/strict';
import series from '../../../../src/infrastructure/persistence/clickhouse/series.js';
import holds from '../../../../src/infrastructure/persistence/clickhouse/holds.js';
import poll from '../../../../src/infrastructure/persistence/clickhouse/pollTopicCursors.js';
import { rawMetricsRange } from '../../../../src/infrastructure/persistence/clickhouse/metricsRelation.js';

const start = new Date('2026-11-08T00:00:00.000Z');
const end = new Date('2026-11-08T00:00:10.000Z');
describe('Bounded native ClickHouse point reads', function() {
    for (const [name, read] of [
        ['series', (connection) => { return series(connection, 'sensor/a', { start, end }, 1000, ''); }],
        ['holds', (connection) => { return holds(connection, 'sensor/a', { start, end }, 3000, ''); }],
        ['live cursors', (connection) => { return poll(connection, [{ topic: 'sensor/a', since: start }], end); }]
    ]) {
        it(`prunes indexed point timestamps for ${name}`, async function() {
            let sql;
            await read({ async query(text) { sql = text; return []; } });
            assert.match(sql, /FROM scada\.metrics_points_v3 FINAL WHERE ts>=/u);
            assert.doesNotMatch(sql, /groupBitmap|bitmapToArray|metrics_compact_v2/u);
        });
    }
    it('marks density-sensitive ranges for an explicit closed-history guard', function() {
        assert.match(rawMetricsRange('{since:Int64}', '{until:Int64}'), /scada-density-range/u);
    });
});
