import assert from 'node:assert/strict';
import metricsQuery from '../../../../src/infrastructure/persistence/clickhouse/metricsQuery.js';
import metricsRelation, { rawMetricsRange } from '../../../../src/infrastructure/persistence/clickhouse/metricsRelation.js';

describe('ClickHouse additive schema read compatibility', function() {
    it('falls back only for missing additive schema and checks it again on the next read', async function() {
        let installed = false;
        const client = { async query({ query }) {
            if (query.includes('metrics_compact_v2') && !installed) { throw Object.assign(new Error('Unknown table metrics_compact_v2'), { code: 60 }); }
            return { async json() { return [{ value: query.includes('metrics_compact_v2') ? 2 : 1 }]; } };
        } };
        const sql = `SELECT * FROM ${metricsRelation}`;
        assert.deepEqual(await metricsQuery(client, sql, {}), [{ value: 1 }]);
        installed = true;
        assert.deepEqual(await metricsQuery(client, sql, {}), [{ value: 2 }]);
    });
    it('falls back bounded canonical reads before schema installation', async function() {
        const client = { async query({ query }) {
            if (query.includes('metrics_compact_v2')) {
                throw Object.assign(new Error('Unknown table metrics_compact_v2'), { code: 60 });
            }
            return { async json() { return [{ value: 7 }]; } };
        } };
        const source = rawMetricsRange('{since:Int64}', '{until:Int64}');
        assert.deepEqual(await metricsQuery(client, `SELECT * FROM ${source} WHERE ts > fromUnixTimestamp64Milli({since:Int64})`,
            { since: 0, until: 1000 }), [{ value: 7 }]);
    });
    it('does not hide permission errors as old schema', async function() {
        const failure = Object.assign(new Error('metrics_compact_v2 access denied'), { code: 497 });
        await assert.rejects(metricsQuery({ async query() { throw failure; } }, `SELECT * FROM ${metricsRelation}`, {}), failure);
    });
});
