import assert from 'node:assert/strict';
import series from '../../../../src/infrastructure/persistence/clickhouse/series.js';
import holds from '../../../../src/infrastructure/persistence/clickhouse/holds.js';
import poll from '../../../../src/infrastructure/persistence/clickhouse/pollTopicCursors.js';

const start = new Date('2026-11-08T00:00:00.000Z');
const end = new Date('2026-11-08T00:00:10.000Z');
describe('Bounded ClickHouse bitmap reads', function() {
    for (const [name, read] of [
        ['series', (connection) => { return series(connection, 'sensor/a', { start, end }, 1000, ''); }],
        ['holds', (connection) => { return holds(connection, 'sensor/a', { start, end }, 3000, ''); }],
        ['live cursors', (connection) => { return poll(connection, [{ topic: 'sensor/a', since: start }], end); }]
    ]) {
        it(`prunes stored time buckets before expanding ${name}`, async function() {
            let sql;
            await read({ async query(text) { sql = text; return []; } });
            assert.match(sql, /FROM scada\.metrics_compact_v2 WHERE bucket_start<=/u);
            assert.match(sql, /bucket_start\+toInt64\(bucket_ms\)>/u);
            assert.ok(sql.indexOf('WHERE bucket_start<=') < sql.indexOf('GROUP BY topic,bucket_start'),
                'The source scan must exclude irrelevant history before bitmap aggregation');
        });
    }
});
