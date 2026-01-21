import assert from 'assert';
import events from '../src/events.js';
import event from '../src/event.js';

describe('events', function() {
    it('creates event with generated id', function() {
        const log = events(event);
        const e = log.create(new Date(), {}, []);
        assert(e.id() === 'ev-0', 'first event should have id ev-0');
    });

    it('creates events with sequential ids', function() {
        const log = events(event);
        log.create(new Date(), {}, []);
        const second = log.create(new Date(), {}, []);
        assert(second.id() === 'ev-1', 'second event should have id ev-1');
    });

    it('creates event with provided timestamp', function() {
        const log = events(event);
        const ts = new Date();
        const e = log.create(ts, {}, []);
        assert(e.timestamp() === ts, 'timestamp mismatch');
    });

    it('creates event with provided properties', function() {
        const log = events(event);
        const machine = `m-${Math.random()}`;
        const e = log.create(new Date(), { machine }, []);
        assert(e.properties().machine === machine, 'properties mismatch');
    });

    it('creates event with provided labels', function() {
        const log = events(event);
        const label = `lbl-${Math.random()}`;
        const e = log.create(new Date(), {}, [label]);
        assert(e.labels()[0] === label, 'labels mismatch');
    });

    it('creates event with empty labels when not provided', function() {
        const log = events(event);
        const e = log.create(new Date(), {});
        assert(e.labels().length === 0, 'labels should be empty');
    });

    it('returns empty array from all when no events exist', function() {
        const log = events(event);
        assert(log.all().length === 0, 'should return empty array');
    });

    it('returns all events from all method', function() {
        const log = events(event);
        log.create(new Date(), {}, []);
        log.create(new Date(), {}, []);
        assert(log.all().length === 2, 'should return all events');
    });

    it('filters events with single filter', function() {
        const log = events(event);
        log.create(new Date(), {}, ['a']);
        log.create(new Date(), {}, ['b']);
        const filtered = log.all((e) => {return e.labels().includes('a')});
        assert(filtered.length === 1, 'should return filtered events');
    });

    it('applies multiple filters with AND logic', function() {
        const log = events(event);
        log.create(new Date(), { value: 1 }, ['a']);
        log.create(new Date(), { value: 2 }, ['a']);
        log.create(new Date(), { value: 3 }, ['b']);
        const filtered = log.all(
            (e) => {return e.labels().includes('a')},
            (e) => {return e.properties().value > 1}
        );
        assert(filtered.length === 1, 'should apply both filters');
    });

    it('finds event by id', function() {
        const log = events(event);
        log.create(new Date(), {}, []);
        const e = log.find('ev-0');
        assert(e !== undefined && e.id() === 'ev-0', 'should find event by id');
    });

    it('returns undefined when event not found', function() {
        const log = events(event);
        const e = log.find('ev-999');
        assert(e === undefined, 'should return undefined');
    });

    it('notifies subscriber when event created', function() {
        const log = events(event);
        let received = null;
        log.stream((evt) => { received = evt; });
        log.create(new Date(), {}, []);
        assert(received !== null && received.type === 'created', 'should notify subscriber');
    });

    it('notifies subscriber with created event', function() {
        const log = events(event);
        let received = null;
        log.stream((evt) => { received = evt; });
        const e = log.create(new Date(), {}, []);
        assert(received !== null && received.event === e, 'should pass created event');
    });

    it('stops notifying after subscription cancelled', function() {
        const log = events(event);
        let count = 0;
        const sub = log.stream(() => { count += 1; });
        log.create(new Date(), {}, []);
        sub.cancel();
        log.create(new Date(), {}, []);
        assert(count === 1, 'should stop notifying after cancel');
    });

    it('evaluates rules when event created', function() {
        let evaluated = false;
        const rs = { evaluate() { evaluated = true; } };
        const log = events(event, rs);
        log.create(new Date(), {}, []);
        assert(evaluated, 'rules were not evaluated');
    });

    it('passes event context to rules', function() {
        let received = null;
        const rs = { evaluate(ctx) { received = ctx; } };
        const log = events(event, rs);
        const created = log.create(new Date(), {}, []);
        assert(received !== null && received.event === created, 'event not passed to rules');
    });
});
