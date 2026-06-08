import { assertThat, hasSegmentCreatedOnOpenStream } from '../../../../helpers/matchers.js';
import segmentStreamScene from '../../../../helpers/segmentStreamScene.js';

describe('timelineStream', function() {
    it('delivers segment_created on SSE when supervisor persists segment after stream opens', async function() {
        assertThat(await segmentStreamScene().afterSupervisorPersist(), hasSegmentCreatedOnOpenStream());
    });
});
