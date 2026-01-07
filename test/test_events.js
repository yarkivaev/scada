import assert from 'assert';
import events from '../src/events.js';

describe('events', function() {
    it('emits event to subscriber', function() {
        const bus = events();
        let received = null;
        bus.stream((e) => { received = e; });
        bus.emit({ type: 'test', value: Math.random() });
        assert(received !== null && received.type === 'test', 'event was not received by subscriber');
    });

    it('emits event to multiple subscribers', function() {
        const bus = events();
        let count = 0;
        bus.stream(() => { count += 1; });
        bus.stream(() => { count += 1; });
        bus.emit({ type: 'test' });
        assert(count === 2, 'event was not received by all subscribers');
    });

    it('stops emitting after subscription cancelled', function() {
        const bus = events();
        let count = 0;
        const sub = bus.stream(() => { count += 1; });
        bus.emit({ type: 'test' });
        sub.cancel();
        bus.emit({ type: 'test' });
        assert(count === 1, 'event was received after cancellation');
    });

    it('does not emit to other subscribers after one cancels', function() {
        const bus = events();
        let first = 0;
        let second = 0;
        const sub1 = bus.stream(() => { first += 1; });
        bus.stream(() => { second += 1; });
        sub1.cancel();
        bus.emit({ type: 'test' });
        assert(first === 0 && second === 1, 'cancellation affected wrong subscriber');
    });
});
