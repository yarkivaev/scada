import assert from 'node:assert/strict';
import nativeMetricsClock from '../../../../src/infrastructure/persistence/clickhouse/nativeMetricsClock.js';
describe('native history publication clock',function(){
    it('uses the authoritative ClickHouse clock despite a different central host clock',async function(){
        const client={async query(){return {async json(){return [{current_ms:'1234567890000'}];}};}};
        assert.equal(await nativeMetricsClock(client),1234567890000);
    });
    it('supports a controlled clock without consulting the server',async function(){
        const client={query(){throw new Error('unexpected query');}};
        assert.equal(await nativeMetricsClock(client,{now:()=>{return 42}}),42);
    });
});
