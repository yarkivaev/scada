import assert from 'node:assert/strict';
import { assertClickhouseBackfillMode as assertBackfillMode } from '../../../src/infrastructure/persistence/clickhouse/telemetryTarget.js';
import { clickhouseHistoryComment as historyComment } from '../../../src/infrastructure/persistence/clickhouse/localHistory.js';

describe('history-owned ClickHouse backfill',function(){
    it('rejects bypass writes but permits read-only verification on a history-owned target',async()=>{
        const client={async query(){return {async json(){return [{comment:historyComment}];}};}};
        await Promise.all(['copy','repair'].map(mode=>{return assert.rejects(assertBackfillMode(client,mode),/history|coordinated/u);}));
        await assertBackfillMode(client,'verify');
    });
    it('keeps the existing ordinary target writable',async()=>{
        const client={async query(){return {async json(){return [{comment:''}];}};}};
        await assertBackfillMode(client,'copy');await assertBackfillMode(client,'repair');
    });
});
