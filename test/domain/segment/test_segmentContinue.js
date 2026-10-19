import assert from 'assert';
import segmentContinue from '../../../src/domain/segment/segmentContinue.js';

function row(name, start, end) {
    return { name, start_time: start, end_time: end };
}

describe('segmentContinue', function() {
    it('keeps one start when the next same-name segment begins inside the continuity budget', function() {
        const budget = 20 + Math.floor(Math.random() * 20);
        const origin = 1_700_600_000_000 + Math.floor(Math.random() * 1e8);
        const priorStart = new Date(origin).toISOString();
        const priorEnd = new Date(origin + 10_000).toISOString();
        const gap = Math.floor(budget * 500);
        const incomingStart = new Date(origin + 10_000 + gap).toISOString();
        const incomingEnd = new Date(origin + 10_000 + gap + 5_000).toISOString();
        const apply = segmentContinue(budget);
        const joined = apply({
            name: 'on',
            start_time: incomingStart,
            end_time: incomingEnd,
            duration: 0
        }, row('on', priorStart, priorEnd));
        assert.strictEqual(joined.start_time, priorStart, 'restart inside a continuous metric run opened a new segment');
    });

    it('does not join across a gap wider than the continuity budget', function() {
        const budget = 15 + Math.floor(Math.random() * 10);
        const origin = 1_700_700_000_000 + Math.floor(Math.random() * 1e8);
        const priorEnd = new Date(origin).toISOString();
        const incomingStart = new Date(origin + (budget * 1000) + 1000).toISOString();
        const apply = segmentContinue(budget);
        const joined = apply({
            name: 'on',
            start_time: incomingStart,
            end_time: incomingStart,
            duration: 0
        }, row('on', new Date(origin - 20_000).toISOString(), priorEnd));
        assert.strictEqual(joined.start_time, incomingStart, 'a real metric gap was glued into the previous segment');
    });

    it('does not join a different segment name', function() {
        const origin = 1_700_800_000_000 + Math.floor(Math.random() * 1e8);
        const incomingStart = new Date(origin + 5_000).toISOString();
        const apply = segmentContinue(30);
        const joined = apply({
            name: 'off',
            start_time: incomingStart,
            end_time: incomingStart,
            duration: 0
        }, row('on', new Date(origin - 40_000).toISOString(), new Date(origin).toISOString()));
        assert.strictEqual(joined.start_time, incomingStart, 'a class change was merged into the previous segment');
    });

    it('recomputes duration from the original start when a closed continuation is joined', function() {
        const origin = 1_700_900_000_000 + Math.floor(Math.random() * 1e8);
        const priorStart = new Date(origin).toISOString();
        const incomingEnd = new Date(origin + 25_000).toISOString();
        const apply = segmentContinue(30);
        const joined = apply({
            name: 'on',
            start_time: new Date(origin + 15_000).toISOString(),
            end_time: incomingEnd,
            duration: 10
        }, row('on', priorStart, new Date(origin + 10_000).toISOString()));
        assert.strictEqual(joined.duration, 25, 'joined close kept the short fragment duration');
    });
});
