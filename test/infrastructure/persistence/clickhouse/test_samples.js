import assert from 'node:assert/strict';
import clickhouseSensor from '../../../../src/infrastructure/persistence/clickhouse/sensor.js';

describe('Raw coverage observations', function() {
    it('reads actual timestamps through the exact-density guard without chart vertices', async function() {
        let request;
        const sensor=clickhouseSensor({async query(sql,params){
            request={sql,params};
            return [{ts:'2026-01-01 00:00:00.123',value:7},{ts:'2026-01-01 00:00:40.456',value:8}];
        }},'sensor/a','a','mm');
        const points=await sensor.samples({start:new Date(0),end:new Date(60000)});
        assert.deepEqual(points.map(row=>{return [row.timestamp.toISOString(),row.value,row.unit];}),[
            ['2026-01-01T00:00:00.123Z',7,'mm'],['2026-01-01T00:00:40.456Z',8,'mm']
        ]);
        assert.match(request.sql,/scada-density-range/u);
        assert.doesNotMatch(request.sql,/scada-native-chart-range|toStartOfInterval/u);
        assert.equal(request.params.topic,'sensor/a');
    });
});
