import { assertThat, hasOperationCreatedOnOpenStream } from '../../../../helpers/matchers.js';
import operationStreamScene from '../../../../helpers/operationStreamScene.js';

describe('operationStream', function() {
    it('delivers operation_created on SSE when upsert runs after stream opens', async function() {
        assertThat(await operationStreamScene().afterUpsert(), hasOperationCreatedOnOpenStream());
    });
});
