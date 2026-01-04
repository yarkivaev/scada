import assert from 'assert';
import activeMelting from '../src/activeMelting.js';

function fakeMachine(data) {
    return {
        measurements() {
            return data;
        }
    };
}

describe('activeMelting', function() {
    it('returns id when id is called', function() {
        const id = `id${  Math.random()}`;
        const machine = fakeMachine({});
        const active = activeMelting(id, machine, new Date(), function() {});
        assert(active.id() === id);
    });

    it('returns completed melting when stop is called', function() {
        const machine = fakeMachine({});
        const active = activeMelting('m1', machine, new Date(), function() {});
        assert(active.stop() !== undefined);
    });

    it('returns completed melting with correct id', function() {
        const id = `id${  Math.random()}`;
        const machine = fakeMachine({});
        const active = activeMelting(id, machine, new Date(), function() {});
        assert(active.stop().id() === id);
    });

    it('returns completed melting with correct start time', function() {
        const machine = fakeMachine({});
        const start = new Date();
        const active = activeMelting('m1', machine, start, function() {});
        assert(active.stop().start() === start);
    });

    it('returns completed melting with end time', function() {
        const machine = fakeMachine({});
        const active = activeMelting('m1', machine, new Date(), function() {});
        assert(active.stop().end() !== undefined);
    });

    it('returns completed melting with measurements from machine', function() {
        const data = { voltage: Math.random(), cosphi: Math.random() };
        const machine = fakeMachine(data);
        const active = activeMelting('m1', machine, new Date(), function() {});
        assert(active.stop().measurements().voltage === data.voltage);
    });

    it('calls onStop callback when stop is called', function() {
        const machine = fakeMachine({});
        let called = false;
        const active = activeMelting('m1', machine, new Date(), function() {
            called = true;
        });
        active.stop();
        assert(called === true);
    });

    it('passes completed melting to onStop callback', function() {
        const id = `id${  Math.random()}`;
        const machine = fakeMachine({});
        let received = null;
        const active = activeMelting(id, machine, new Date(), function(completed) {
            received = completed;
        });
        active.stop();
        assert(received.id() === id);
    });
});
