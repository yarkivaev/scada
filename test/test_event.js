import assert from 'assert';
import event from '../src/event.js';

describe('event', function() {
    it('returns id passed to factory', function() {
        const id = `ev-${Math.random()}`;
        const e = event(id, new Date(), {}, []);
        assert(e.id() === id, 'id mismatch');
    });

    it('returns timestamp passed to factory', function() {
        const ts = new Date();
        const e = event('ev-1', ts, {}, []);
        assert(e.timestamp() === ts, 'timestamp mismatch');
    });

    it('returns properties passed to factory', function() {
        const machine = `m-${Math.random()}`;
        const props = { machine };
        const e = event('ev-1', new Date(), props, []);
        assert(e.properties().machine === machine, 'properties mismatch');
    });

    it('returns labels passed to factory', function() {
        const label = `lbl-${Math.random()}`;
        const e = event('ev-1', new Date(), {}, [label]);
        assert(e.labels()[0] === label, 'labels mismatch');
    });

    it('returns copy of labels array', function() {
        const labels = ['a', 'b'];
        const e = event('ev-1', new Date(), {}, labels);
        const returned = e.labels();
        returned.push('c');
        assert(e.labels().length === 2, 'labels array was mutated');
    });

    it('returns empty labels when empty array provided', function() {
        const e = event('ev-1', new Date(), {}, []);
        assert(e.labels().length === 0, 'labels should be empty');
    });

    it('returns same properties reference', function() {
        const props = { value: Math.random() };
        const e = event('ev-1', new Date(), props, []);
        assert(e.properties() === props, 'properties should be same reference');
    });

    it('preserves multiple labels', function() {
        const e = event('ev-1', new Date(), {}, ['a', 'b', 'c']);
        assert(e.labels().length === 3, 'all labels should be preserved');
    });
});
