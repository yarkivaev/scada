import assert from 'assert';
import userDecisionBody from '../../../../src/infrastructure/messaging/stomp/userDecisionBody.js';

describe('userDecisionBody', function() {
    it('encodes start as epoch seconds from Date', function() {
        const start = new Date('2024-05-01T12:00:00.000Z');
        const body = userDecisionBody('icht-π', start, 'hmi', ['heating'], { k: 1 });
        assert.strictEqual(body.machine, 'icht-π', 'machine should be copied');
        assert.strictEqual(body.start, start.getTime() / 1000, 'start should be epoch seconds');
    });

    it('defaults empty tags and properties when omitted', function() {
        const start = new Date('2024-05-02T00:00:00.000Z');
        const body = userDecisionBody('icht1', start, 'op', null, null);
        assert.deepStrictEqual(body.tags, [], 'tags should default to empty array');
        assert.deepStrictEqual(body.properties, {}, 'properties should default to empty object');
    });
});
