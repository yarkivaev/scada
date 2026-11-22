import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import historyRevision from '../../../../src/infrastructure/persistence/pg/historyRevision.js';

describe('closed history revision', function() {
    it('does not change when a later furnace observation arrives after the claimed until', function() {
        const until = 1700000030000;
        const closed = {
            initial: { time: until, values: { мощность: 1.25 } },
            annotations: [],
            segments: [{ name: 'off', start_time: new Date(until - 30000) }],
            items: [{ eventId: 'печь-α', time: until, value: 1.25 }],
            continuity: [{ from: until - 30000, until }],
            page: { until },
            rightClosed: true
        };
        const live = {
            ...closed,
            items: [...closed.items, { eventId: 'печь-β', time: until + 2500, value: 9.75 }],
            continuity: [...closed.continuity, { from: until + 1, until: until + 2500 }],
            page: { until: until + 60000 },
            rightClosed: false
        };
        assert.equal(historyRevision(live, until), historyRevision(closed, until),
            'live padding changed the closed work revision');
    });
    it('does not change when a live covering heartbeat moves past the claimed until', function() {
        const until = 1700000030000;
        const closed = {
            initial: null,
            annotations: [],
            segments: [{ name: 'off', start_time: new Date(until - 8_000_000), end_time: new Date(until), duration: 0 }],
            items: [{ eventId: 'см-α', time: until, value: 1.25 }],
            continuity: [{ from: until - 30000, until }]
        };
        const live = {
            ...closed,
            segments: [{ ...closed.segments[0], end_time: new Date(until + 5741) }]
        };
        assert.equal(historyRevision(live, until), historyRevision(closed, until),
            'a live covering heartbeat changed the closed work revision');
    });
    it('pins closed-page revision into the history context', function() {
        const body = readFileSync(new URL('../../../../src/infrastructure/persistence/pg/historyContext.js', import.meta.url), 'utf8');
        assert.match(body, /historyRevision\(snapshot, until, timeScale\)/u,
            'history context still hashed the live padded snapshot');
    });
});
