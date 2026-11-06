import assert from 'node:assert/strict';
import stompOptions from '../../../../src/infrastructure/ingest/pipelines/stompOptions.js';

describe('STOMP pipeline lifecycle options', () => {
    it('preserves deadlines and failure/state notifications at the transport boundary', () => {
        const onError = () => {};
        const onFatal = () => {};
        const onState = () => {};
        const settings = { acceptTimeoutMs: 300, deliveryTimeoutMs: 600, stopTimeoutMs: 500, onError, onFatal, onState };
        assert.deepEqual(stompOptions(settings), settings);
    });
});
