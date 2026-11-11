import assert from 'node:assert/strict';
import bounds from '../../../../src/infrastructure/persistence/pg/historyNativeBounds.js';

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
