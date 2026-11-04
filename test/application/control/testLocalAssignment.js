import assert from 'node:assert/strict';
import localAssignment from '../../../src/application/control/localAssignment.js';
describe('replica protocol identities', () => {
    it('separates MQTT clients by task and node without mutating logical assignment', () => {
        const input = { taskId: 'plant/power', generation: 1, specHash: 'logical', spec: { config: { clientId: 'collector' }, source: { type: 'mqtt', options: { clientId: 'source' } }, sinks: [{ type: 'mqtt', options: { clientId: 'sink' } }] } };
        const first = localAssignment(input, 'a');
        const second = localAssignment(input, 'b');
        assert.notEqual(first.spec.config.clientId, second.spec.config.clientId);
        assert.notEqual(first.spec.source.options.clientId, second.spec.source.options.clientId);
        assert.notEqual(first.spec.sinks[0].options.clientId, second.spec.sinks[0].options.clientId);
        assert.equal(first.taskId, input.taskId);
        assert.equal(input.spec.config.clientId, 'collector');
        assert.equal(first.specHash, undefined);
        assert.deepEqual(localAssignment(input, 'a'), first);
    });
});
