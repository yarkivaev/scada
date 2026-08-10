import assert from 'assert';
import { metricsSinkFromPool } from '../../../../src/infrastructure/persistence/pg/metrics.js';

describe('pgMetricsSink', function() {
    it('inserts batched records into metrics table', async function() {
        const queries = [];
        const pool = {
            async query(sql, params) {
                queries.push({ sql, params });
            }
        };
        const sink = metricsSinkFromPool(pool);
        const topic = `MX210/m-${Math.random()}/GET/AI1/VALUE`;
        const value = Math.random() * 400;
        const ts = new Date();
        await sink.write([{ topic, ts, value }]);
        assert.strictEqual(queries.length, 1, 'sink did not insert into metrics table');
    });
});
