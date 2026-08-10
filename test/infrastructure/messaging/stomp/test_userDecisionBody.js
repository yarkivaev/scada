import assert from 'assert';
import userDecisionBody from '../../../../src/infrastructure/messaging/stomp/userDecisionBody.js';

function audit(displayName, id, decidedAt) {
    return { displayName, id, decidedAt };
}

describe('userDecisionBody', function() {
    it('includes operator_id and decided_at in STOMP body', function() {
        const start = new Date('2024-05-01T12:00:00.000Z');
        const decidedAt = new Date('2024-05-01T12:01:00.000Z');
        const body = userDecisionBody('m-π', start, ['heating'], { k: 1 }, audit('Elena Volkov', 7, decidedAt));
        assert.strictEqual(body.operator_id, 7, 'operator_id should be included');
    });

    it('encodes start as epoch seconds from Date', function() {
        const start = new Date('2024-05-01T12:00:00.000Z');
        const decidedAt = new Date('2024-05-01T12:01:00.000Z');
        const body = userDecisionBody('m-π', start, ['heating'], { k: 1 }, audit('hmi', undefined, decidedAt));
        assert.strictEqual(body.start, start.getTime() / 1000, 'start should be epoch seconds');
    });

    it('defaults empty tags and properties when omitted', function() {
        const start = new Date('2024-05-02T00:00:00.000Z');
        const decidedAt = new Date('2024-05-02T00:01:00.000Z');
        const body = userDecisionBody('m1', start, null, null, audit('op', null, decidedAt));
        assert.deepStrictEqual(body.tags, [], 'tags should default to empty array');
    });
});
