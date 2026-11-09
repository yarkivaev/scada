import assert from 'node:assert/strict';
import clickhouseSeries from '../../../../src/infrastructure/persistence/clickhouse/series.js';

describe('Gap-preserving chart rows', function() {
    it('keeps null separators and marks only certified same-segment connections', async function() {
        const rows = [
            {ts:'2026-01-01 00:00:00.000',value:7,segment:1,native:1},
            {ts:'2026-01-01 00:00:10.000',value:7,segment:1,native:1},
            {ts:'2026-01-01 00:00:40.000',value:7,segment:2,native:1},
            {ts:'2026-01-01 00:00:50.000',value:7,segment:2,native:1}
        ];
        const result = await clickhouseSeries({async query(){return rows;}},'a',{
            start:new Date('2026-01-01T00:00:00Z'),end:new Date('2026-01-01T00:01:00Z')
        },60000,'mm');
        assert.deepEqual(result.map(row=>{return row.value}),[7,7,null,7,7]);
        assert.deepEqual(result.filter(row=>{return row.value!==null}).map(row=>{return row.continuous}),[false,true,false,true]);
        assert.equal(result[2].timestamp.toISOString(),'2026-01-01T00:00:25.000Z');
    });
    it('preserves adjacent millisecond policy endpoints without a colliding separator', async function() {
        const result=await clickhouseSeries({async query(){return [
            {ts:'2026-01-01 00:00:00.000',value:7,segment:1,native:1},
            {ts:'2026-01-01 00:00:00.001',value:9,segment:2,native:1}
        ];}},'a',{start:new Date(0),end:new Date(1000)},1000,'');
        assert.deepEqual(result.map(row=>{return row.value;}),[7,9]);
        assert.equal(result[1].continuous,false);
    });
    it('preserves null and legacy rows without claiming native continuity', async function() {
        const result = await clickhouseSeries({async query(){return [
            {ts:'2026-01-01 00:00:00.123',value:7},
            {ts:'2026-01-01 00:00:01.456',value:null}
        ];}},'a',{start:new Date(0),end:new Date(1000)},1000,'');
        assert.equal(result[1].value,null);
        assert.equal(result[0].timestamp.getUTCMilliseconds(),123);
        assert.equal(Object.hasOwn(result[0],'continuous'),false);
    });
});
