import assert from 'node:assert/strict';
import metricsQuery from '../../../../src/infrastructure/persistence/clickhouse/metricsQuery.js';
import metricsRelation, { rawMetricsRange } from '../../../../src/infrastructure/persistence/clickhouse/metricsRelation.js';

describe('ClickHouse additive schema read compatibility', function() {
    it('falls back only for missing additive schema and checks it again on the next read', async function() {
        let installed = false;
        const client = { async query({ query }) {
            if (query.includes('metrics_points_v3') && !installed) { throw Object.assign(new Error('Unknown table metrics_points_v3'), { code: 60 }); }
            return { async json() { return [{ value: query.includes('metrics_points_v3') ? 2 : 1 }]; } };
        } };
        const sql = `SELECT * FROM ${metricsRelation}`;
        assert.deepEqual(await metricsQuery(client, sql, {}), [{ value: 1 }]);
        installed = true;
        assert.deepEqual(await metricsQuery(client, sql, {}), [{ value: 2 }]);
    });
    it('falls back bounded canonical reads before schema installation', async function() {
        const client = { async query({ query }) {
            if (query.includes('metrics_points_v3')) {
                throw Object.assign(new Error('Unknown table metrics_points_v3'), { code: 60 });
            }
            return { async json() { return [{ value: 7 }]; } };
        } };
        const source = rawMetricsRange('{since:Int64}', '{until:Int64}');
        assert.deepEqual(await metricsQuery(client, `SELECT * FROM ${source} WHERE ts > fromUnixTimestamp64Milli({since:Int64})`,
            { since: 0, until: 1000 }), [{ value: 7 }]);
    });
    it('does not hide permission errors as old schema', async function() {
        const failure = Object.assign(new Error('metrics_points_v3 access denied'), { code: 497 });
        await assert.rejects(metricsQuery({ async query() { throw failure; } }, `SELECT * FROM ${metricsRelation}`, {}), failure);
    });
});


describe('Closed-history sample density guard', function() {
    it('rejects a density aggregate before it can silently count archived endpoints', async function() {
        const calls = [];
        const client = { async query({query}) {
            calls.push(query);
            return { async json() { return [{topic:'sensor/a'}]; } };
        } };
        await assert.rejects(metricsQuery(client, `SELECT count() FROM ${rawMetricsRange('{since:Int64}', '{until:Int64}')}`,
            {topics:['sensor/a'],since:0,until:1000}), {code:'SCADA_HISTORY_DENSITY_UNAVAILABLE'});
        assert.equal(calls.length,1);
        assert.match(calls[0], /scada-density-check/u);
    });
    it('checks only selected topics and then executes a recent raw query', async function() {
        const calls = [];
        const client = { async query({query,query_params:params}) {
            calls.push({query,params});
            return { async json() { return query.includes('scada-density-check') ? [] : [{count:3}]; } };
        } };
        const result = await metricsQuery(client, `SELECT count() FROM ${rawMetricsRange('{since:Int64}', '{until:Int64}')}`,
            {topic:'sensor/a',since:0,until:1000});
        assert.deepEqual(result,[{count:3}]);
        assert.deepEqual(calls[0].params.scadaDensityTopics,['sensor/a']);
        assert.equal(calls.length,2);
        assert.doesNotMatch(calls[1].query,/scada-density-range/u);
    });
});


describe('Multiple raw ranges share one bounded density check', function() {
    it('does not spend an unbounded series of requests after the earliest range check', async function() {
        const calls=[];
        const client={async query({query}){calls.push(query);return {async json(){return [];}};}};
        await metricsQuery(client,`SELECT count() FROM ${rawMetricsRange('{fromOne:Int64}','{untilOne:Int64}')} UNION ALL SELECT count() FROM ${rawMetricsRange('{fromTwo:Int64}','{untilTwo:Int64}')}`,
            {topic:'sensor/a',fromOne:0,untilOne:1000,fromTwo:2000,untilTwo:3000});
        assert.equal(calls.length,2,'One bounded density request plus one bounded data request');
        assert.match(calls[0],/\{fromOne:Int64\}/u);assert.match(calls[0],/\{fromTwo:Int64\}/u);
    });
});
