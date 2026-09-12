import assert from 'assert';
import { bindSiteOperations } from '../../src/application/siteServer.js';
import { acceptOperationDeliver } from '../../src/infrastructure/sync/operationSyncIngest.js';
import operationCodec from '../../src/infrastructure/sync/operationCodec.js';
import operationSyncSink from '../../src/infrastructure/sync/operationSyncSink.js';
import stateDataFromMemory from '../../src/infrastructure/persistence/stateDataFromMemory.js';

function deletedBody(key) {
    return Buffer.from(JSON.stringify({
        type: 'deleted',
        machine: 'icht3',
        occurred_at: '2026-09-10T10:29:19.000Z',
        kind: 'sample',
        external_key: key
    }));
}

describe('siteServer operation sync', function() {
    it('drops a federated delete after the central plantOperations wrap', async function() {
        const sink = { dataAccess: stateDataFromMemory() };
        bindSiteOperations(sink);
        const codec = operationCodec(operationSyncSink(sink.dataAccess.operations));
        const key = `bath:icht3:${Math.random().toString(36).slice(2)}`;
        await assert.doesNotReject(
            () => {
                return acceptOperationDeliver(codec, deletedBody(key));
            },
            'central site wrap cannot reject federated delete of an absent key'
        );
    });
});
