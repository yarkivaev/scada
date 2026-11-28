import assert from 'node:assert/strict';
import * as core from '@yarkivaev/scada';
const clickhouseJsonMetrics = core.clickhouseJsonMetrics;

describe('central JSONEachRow metrics admission', function() {
    it('cannot acknowledge a far-future timestamp that would overflow ClickHouse', async function() {
        const metrics = clickhouseJsonMetrics({
            insert() { return Promise.resolve(); }
        }, { clock() { return Date.parse('2026-11-21T08:00:00Z'); }, maxFutureMs: 300000 });
        await assert.rejects(metrics.insertRows([{
            topic: 'OPCUA/unit-1/GET/speed/VALUE',
            ts: '2299-12-31 23:59:59.000',
            value: 1
        }]), Error, 'Far-future telemetry was admitted into ClickHouse');
    });
    it('writes the original timestamp to a caller-selected JSONEachRow table', async function() {
        let actual;
        await clickhouseJsonMetrics({
            insert(request) { actual = request; return Promise.resolve(); }
        }, { table: 'custom.metrics', minTimestamp: 0 }).insertRows([{
            topic: 'SENSOR/unit-1/GET/temperature/VALUE',
            ts: Date.parse('2026-11-21T00:11:37Z'),
            value: 7
        }]);
        assert.equal(actual.format, 'JSONEachRow');
        assert.equal(actual.table, 'custom.metrics');
        assert.equal(actual.values[0].ts, Date.parse('2026-11-21T00:11:37Z'));
    });
});
