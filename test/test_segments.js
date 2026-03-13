import assert from 'assert';
import segments from '../src/segments.js';

describe('segments', function() {
    it('returns empty array when no segments added', function() {
        const collection = segments();
        assert(collection.query().length === 0, 'query did not return empty array');
    });

    it('returns added segment from query', function() {
        const collection = segments();
        const name = `seg-${Math.random()}`;
        collection.add({ name, startTime: new Date(), endTime: new Date(), duration: 60 });
        assert(collection.query().length === 1, 'query did not return one segment');
    });

    it('returns multiple segments from query', function() {
        const collection = segments();
        collection.add({ name: `a-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 60 });
        collection.add({ name: `b-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 120 });
        collection.add({ name: `c-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 180 });
        assert(collection.query().length === 3, 'query did not return three segments');
    });

    it('preserves segment name after add', function() {
        const collection = segments();
        const name = `nàme-${Math.random()}`;
        collection.add({ name, startTime: new Date(), endTime: new Date(), duration: 60 });
        assert(collection.query()[0].name === name, 'segment name not preserved');
    });

    it('preserves segment duration after add', function() {
        const collection = segments();
        const duration = Math.floor(Math.random() * 10000);
        collection.add({ name: `s-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration });
        assert(collection.query()[0].duration === duration, 'segment duration not preserved');
    });

    it('relabels segment tags by start time', function() {
        const collection = segments();
        const start = new Date('2026-03-15T10:00:00Z');
        collection.add({ name: `off-${Math.random()}`, startTime: start, endTime: new Date(), duration: 60 });
        const tags = [`héating-${Math.random()}`];
        collection.relabel(start, tags, {});
        assert.deepStrictEqual(collection.query()[0].tags, tags, 'segment tags not set after relabel');
    });

    it('relabels segment properties by start time', function() {
        const collection = segments();
        const start = new Date('2026-03-15T10:00:00Z');
        collection.add({ name: `off-${Math.random()}`, startTime: start, endTime: new Date(), duration: 60 });
        const properties = { weight: Math.floor(Math.random() * 1000) };
        collection.relabel(start, [`tàg-${Math.random()}`], properties);
        assert.deepStrictEqual(collection.query()[0].properties, properties, 'segment properties not set after relabel');
    });

    it('does not relabel when start time does not match', function() {
        const collection = segments();
        collection.add({ name: `orig-${Math.random()}`, tags: [], startTime: new Date('2026-03-15T10:00:00Z'), endTime: new Date(), duration: 60 });
        collection.relabel(new Date('2026-03-15T11:00:00Z'), ['other'], {});
        assert.deepStrictEqual(collection.query()[0].tags, [], 'segment was incorrectly relabeled');
    });

    it('filters segments by from option', function() {
        const collection = segments();
        collection.add({ name: `a-${Math.random()}`, startTime: new Date('2026-01-01T00:00:00Z'), endTime: new Date('2026-01-01T01:00:00Z'), duration: 3600 });
        collection.add({ name: `b-${Math.random()}`, startTime: new Date('2026-01-02T00:00:00Z'), endTime: new Date('2026-01-02T01:00:00Z'), duration: 3600 });
        assert(collection.query({ from: '2026-01-01T12:00:00Z' }).length === 1, 'from filter did not exclude old segment');
    });

    it('filters segments by to option', function() {
        const collection = segments();
        collection.add({ name: `a-${Math.random()}`, startTime: new Date('2026-01-01T00:00:00Z'), endTime: new Date('2026-01-01T01:00:00Z'), duration: 3600 });
        collection.add({ name: `b-${Math.random()}`, startTime: new Date('2026-01-03T00:00:00Z'), endTime: new Date('2026-01-03T01:00:00Z'), duration: 3600 });
        assert(collection.query({ to: '2026-01-02T00:00:00Z' }).length === 1, 'to filter did not exclude future segment');
    });

    it('returns all segments when options have no from or to', function() {
        const collection = segments();
        collection.add({ name: `x-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 60 });
        collection.add({ name: `y-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 120 });
        assert(collection.query({}).length === 2, 'query with empty options did not return all');
    });

    it('emits created event on add', function() {
        const collection = segments();
        let received = null;
        collection.stream((e) => { received = e; });
        collection.add({ name: `ev-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 60 });
        assert(received !== null && received.type === 'created', 'created event not emitted');
    });

    it('emits created event with added segment', function() {
        const collection = segments();
        let received = null;
        collection.stream((e) => { received = e; });
        const name = `évt-${Math.random()}`;
        collection.add({ name, startTime: new Date(), endTime: new Date(), duration: 60 });
        assert(received.segment.name === name, 'created event has wrong segment');
    });

    it('emits relabeled event on relabel', function() {
        const collection = segments();
        const start = new Date('2026-05-01T08:00:00Z');
        collection.add({ name: `old-${Math.random()}`, startTime: start, endTime: new Date(), duration: 60 });
        let received = null;
        collection.stream((e) => { received = e; });
        collection.relabel(start, [`tàg-${Math.random()}`], {});
        assert(received !== null && received.type === 'relabeled', 'relabeled event not emitted');
    });

    it('emits relabeled event with updated tags', function() {
        const collection = segments();
        const start = new Date('2026-05-01T08:00:00Z');
        collection.add({ name: `old-${Math.random()}`, startTime: start, endTime: new Date(), duration: 60 });
        let received = null;
        collection.stream((e) => { received = e; });
        const tags = [`ñew-${Math.random()}`];
        collection.relabel(start, tags, {});
        assert.deepStrictEqual(received.segment.tags, tags, 'relabeled event has wrong tags');
    });

    it('stops notifying after subscription cancelled', function() {
        const collection = segments();
        let count = 0;
        const sub = collection.stream(() => { count += 1; });
        collection.add({ name: `a-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 60 });
        sub.cancel();
        collection.add({ name: `b-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 120 });
        assert(count === 1, 'subscriber was notified after cancellation');
    });

    it('preserves options on segment', function() {
        const collection = segments();
        const options = { power: Math.floor(Math.random() * 1000) };
        collection.add({ name: `s-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 60, options });
        assert(collection.query()[0].options === options, 'segment options not preserved');
    });

    it('retags segment tags by start time', function() {
        const collection = segments();
        const start = new Date('2026-03-15T10:00:00Z');
        collection.add({ name: `off-${Math.random()}`, startTime: start, endTime: new Date(), duration: 60, tags: [`öld-${Math.random()}`], options: ['a'] });
        const tags = [`rétag-${Math.random()}`];
        collection.retag(start, tags, {});
        assert.deepStrictEqual(collection.query()[0].tags, tags, 'segment tags not set after retag');
    });

    it('retags segment and strips options', function() {
        const collection = segments();
        const start = new Date('2026-03-15T10:00:00Z');
        collection.add({ name: `off-${Math.random()}`, startTime: start, endTime: new Date(), duration: 60, options: ['a', 'b'] });
        collection.retag(start, [`tàg-${Math.random()}`], {});
        assert(collection.query()[0].options === undefined, 'options not stripped after retag');
    });

    it('emits relabeled event on retag', function() {
        const collection = segments();
        const start = new Date('2026-05-01T08:00:00Z');
        collection.add({ name: `old-${Math.random()}`, startTime: start, endTime: new Date(), duration: 60 });
        let received = null;
        collection.stream((e) => { received = e; });
        collection.retag(start, [`tàg-${Math.random()}`], {});
        assert(received !== null && received.type === 'relabeled', 'relabeled event not emitted on retag');
    });

    it('returns copy of items from query without options', function() {
        const collection = segments();
        collection.add({ name: `s-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 60 });
        const first = collection.query();
        const second = collection.query();
        assert(first !== second, 'query returned same array reference');
    });
});
