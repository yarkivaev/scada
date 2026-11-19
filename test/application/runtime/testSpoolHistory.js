import assert from 'node:assert/strict';
import spoolHistory from '../../../src/application/runtime/spoolHistory.js';

describe('collector spool history', function() {
    it('exposes undelivered ICHT samples as HistoryRun work', async function() {
        const history = spoolHistory({
            peek() {
                return [{ event: { eventId: 'sp-я', routingKey: 'MX210.icht-2.GET.AI4.VALUE',
                    body: Buffer.from('{"ts":88,"value":0.4}') } }];
            }
        });
        const work = await history.work('icht2');
        assert.equal(work.items[0].from, 88, 'spool HistoryRun lost the surviving sample');
    });
    it('returns empty pending segments for SupervisorSinkCheckpoint', async function() {
        const history = spoolHistory({ peek() { return []; } });
        assert.deepEqual(await history.pendingSegments(), [], 'empty spool invented pending segments');
    });
});
