import assert from 'node:assert/strict';
import bounds, { clipReplacePage, joinReplacePage } from '../../../../src/infrastructure/persistence/pg/historyNativeBounds.js';

describe('Native history exterior boundary',()=>{
    const owner={kind:'phase',name:'off',start_time:new Date(0),end_time:new Date(10001)};
    const latest={segments:[owner],context:{page:{until:10000}}};
    it('does not discard an existing endpoint only one millisecond beyond the page',()=>{
        assert.throws(()=>{bounds([{...owner,end_time:new Date(10000)}],latest,{},1);},/tail/u);
    });
    it('can retain that endpoint as a proved singleton exterior',()=>{
        const suffix={...owner,start_time:new Date(10001),preserveSuffix:owner};
        assert.deepEqual(bounds([{...owner,end_time:new Date(10000)},suffix],latest,{nativeTailMode:'preserve-known-suffix-v1'},1),[suffix]);
    });
});

function page(until) {
    return { context: { page: { until } }, segments: [] };
}

describe('replace page covering clip', function() {
    it('closes a covering interval at the observed page until', function() {
        const until = Date.parse('2026-11-22T20:40:00.000Z');
        const rows = clipReplacePage([{
            kind: 'phase',
            name: 'off',
            start_time: '2026-11-22T20:36:32.293Z',
            end_time: '2026-11-23T06:21:51.724Z',
            duration: 35119.431
        }], page(until * 1000), 1000);
        assert.equal(Date.parse(rows[0].end_time), until, 'covering off kept an exterior end');
    });
    it('accepts a replace covering after clipReplacePage', function() {
        const until = Date.parse('2026-11-22T20:40:00.000Z');
        const latest = page(until * 1000);
        const rows = clipReplacePage([{
            kind: 'phase',
            name: 'off',
            start_time: '2026-11-22T20:36:32.293Z',
            end_time: '2026-11-23T06:21:51.724Z',
            duration: 35119.431
        }], latest, 1000);
        assert.deepEqual(bounds(rows, latest, { replace: true }, 1000), [],
            'clipped covering still threw on native bounds');
    });
    it('joins nested same-name offs onto the earlier start', function() {
        const rows = joinReplacePage([
            { kind: 'phase', name: 'off', start_time: '2026-11-23T13:32:45.000Z',
                end_time: '2026-11-23T13:33:18.000Z', duration: 33 },
            { kind: 'phase', name: 'off', start_time: '2026-11-23T13:09:27.000Z',
                end_time: '2026-11-23T13:33:15.000Z', duration: 1428 }
        ]);
        assert.deepEqual({
            length: rows.length,
            start: rows[0].start_time,
            end: rows[0].end_time
        }, {
            length: 1,
            start: '2026-11-23T13:09:27.000Z',
            end: '2026-11-23T13:33:18.000Z'
        }, 'overlapping offs stayed a nested pair');
    });
});
