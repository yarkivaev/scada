import assert from 'node:assert/strict';
import historyContext from '../../../../src/infrastructure/persistence/pg/historyContext.js';
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
    for (const claimScope of [false, true]) {
        it(`pins the history revision to the closed horizon with claimScope=${claimScope}`, async function () {
            const from = 1700000000000;
            const until = from + 30000;
            const horizon = claimScope ? until - 5000 : until;
            const pool = {
                async query(sql) {
                    if (sql.includes('AS open_ms')) { return { rows: [{ open_ms: until + 60001 }] }; }
                    return { rows: [], rowCount: 0 };
                }
            };
            const source = {
                items: [{ eventId: 'closed', channel: 'power', time: horizon, value: 1.25 }],
                async boundary() { return until + 60000; },
                async page(machine, left, end) {
                    assert.equal(machine, 'line-1');
                    return { from: left, until: end, next: null, end };
                },
                async read(machine, left, right) {
                    assert.equal(machine, 'line-1');
                    const items = this.items.filter(({ time }) => { return time >= left && time <= right; });
                    return { items, continuity: [] };
                },
                async seed() { return null; }
            };
            const options = { padding: 60000, cutoff: -Infinity, observations: source, claimScope,
                ...(claimScope && { end: horizon }) };
            const before = await historyContext(pool, 'line-1', from, until, options);
            source.items.push({ eventId: 'later', channel: 'power', time: horizon + 1000, value: 2 });
            const after = await historyContext(pool, 'line-1', from, until, options);
            assert.equal(after.items.length, 2, 'the later observation was inside the context page');
            assert.equal(after.revision, before.revision, 'an observation after the closed horizon changed the revision');
            source.items[0].value = 3;
            const updated = await historyContext(pool, 'line-1', from, until, options);
            assert.notEqual(updated.revision, before.revision, 'a change inside the closed horizon did not invalidate the revision');
        });
    }
});
