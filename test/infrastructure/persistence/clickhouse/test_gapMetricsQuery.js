import assert from 'node:assert/strict';
import metricsQuery from '../../../../src/infrastructure/persistence/clickhouse/metricsQuery.js';
import { chartMetricsRange, holdsMetricsRange } from '../../../../src/infrastructure/persistence/clickhouse/metricsRelation.js';

describe('Native chart legacy compatibility', function() {
    it('never executes an installed old canonical view before checking v4 compatibility', async function() {
        const calls=[];
        const client={async query({query}) {
            calls.push(query);
            if(query.includes('system.tables')) {return {async json(){return [{name:'metrics_points_v3'}];}};}
            if(query.includes('metrics_points_v4')) {throw Object.assign(new Error('Unknown table metrics_points_v4'),{code:60});}
            return {async json(){return [{value:7}];}};
        }};
        await assert.rejects(metricsQuery(client,'SELECT * FROM scada.metrics_read',{}),/explicit v4 migration/u);
        assert(calls.every(sql=>{return !sql.includes('FROM scada.metrics_read');}));
    });
    it('rejects old native tables rather than silently reading only legacy metrics', async function() {
        const client={async query({query}) {
            if(query.includes('system.tables')) {return {async json(){return [{name:'metrics_points_v3'}];}};}
            throw Object.assign(new Error('Unknown table metrics_points_v4'),{code:60});
        }};
        await assert.rejects(metricsQuery(client,`SELECT * FROM ${chartMetricsRange('0','1000')}`,{}),/explicit v4 migration/u);
    });

    it('preserves the metadata shape and outer downsampling on missing native schema', async function() {
        const calls=[];
        const client={async query({query}) {
            calls.push(query);
            if(query.includes('metrics_points_v4')) {throw Object.assign(new Error('Unknown table metrics_points_v4'),{code:60});}
            return {async json(){return [];}};
        }};
        await metricsQuery(client,`SELECT coverage_first_ms,coverage_last_ms,max_gap_ms,native,count() FROM ${chartMetricsRange('{since:Int64}','{until:Int64}')} GROUP BY coverage_first_ms,coverage_last_ms,max_gap_ms,native`,{since:0,until:1000});
        assert.equal(calls.length,3);
        assert.match(calls[2],/toUnixTimestamp64Milli\(ts\) AS coverage_first_ms/u);
        assert.match(calls[2],/count\(\)/u);
        assert.doesNotMatch(calls[2],/metrics_points_v4/u);
        assert.match(calls[1],/system.tables/u);
    });
});


describe('Certified holds density threshold', function() {
    it('guards only certified or logically thinned islands rather than every raw pair', async function() {
        let sql='';
        const client={async query({query}) {sql ||= query;return {async json(){return [];}};}};
        await metricsQuery(client,`SELECT * FROM ${holdsMetricsRange('0','1000','{gap:UInt64}')}`,{topic:'a',gap:100});
        assert.match(sql,/valid_certificate OR \(compactable AND island_n>2\)/u);
    });
    it('computes cross-window constant bridges before clipping chart ranges', function() {
        const sql=chartMetricsRange('59950','60050');
        assert.match(sql,/prior_window_start/u);
        assert.match(sql,/point_ms-prior_ms<=toInt64\(max_gap_ms\)/u);
    });
    it('bounds the unavailable-density check by the requested gap', async function() {
        const calls=[];
        const client={async query({query}) {
            calls.push(query);
            return {async json(){return [];}};
        }};
        await metricsQuery(client,`SELECT * FROM ${holdsMetricsRange('0','1000','{gap:UInt64}')}`,{topic:'a',gap:1000});
        assert.equal(calls.length,2);
        assert.match(calls[0],/max_gap_ms>\(\{gap:UInt64\}\)/u);
        assert.doesNotMatch(calls[1],/scada-density-range/u);
    });
    it('does not hide a permission failure while checking legacy migration state', async function() {
        const denied=Object.assign(new Error('system.tables denied'),{code:497});
        const client={async query({query}) {
            if(query.includes('system.tables')) {throw denied;}
            throw Object.assign(new Error('Unknown table metrics_points_v4'),{code:60});
        }};
        await assert.rejects(metricsQuery(client,`SELECT * FROM ${chartMetricsRange('0','1000')}`,{}),denied);
    });
});
