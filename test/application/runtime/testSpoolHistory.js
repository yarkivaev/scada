import assert from 'node:assert/strict';
import spoolHistory from '../../../src/application/runtime/spoolHistory.js';

describe('collector spool history', function() {
    const queued = {
        peek() {
            return [{ event: { eventId: 'sample-1', routingKey: 'modbus.sensor-42.GET.AI4.VALUE',
                body: Buffer.from('{"ts":88,"value":0.4}') } }];
        }
    };

    it('uses the device identifier in a generic telemetry topic as the default machine', async function() {
        const work = await spoolHistory(queued).work('sensor-42');
        assert.equal(work.items[0]?.from, 88, 'spool HistoryRun lost the surviving sample');
    });
    it('resolves machine aliases supplied by the application without changing stored topics', async function() {
        const history = spoolHistory(queued, topic => {
            return topic === 'modbus/sensor-42/GET/AI4/VALUE' ? 'line-A' : null;
        });
        assert.deepEqual((await history.work('sensor-42')).items, []);
        assert.deepEqual((await history.context('line-A', 88, 88)).items,
            [{ eventId: 'sample-1', channel: 'AI4', time: 88, value: 0.4 }]);
    });
    it('returns empty pending segments for SupervisorSinkCheckpoint', async function() {
        const history = spoolHistory({ peek() { return []; } });
        assert.deepEqual(await history.pendingSegments(), [], 'empty spool invented pending segments');
    });
});
