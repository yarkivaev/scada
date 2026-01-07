import assert from 'assert';
import activeMelting from '../src/activeMelting.js';

function fakeMachine() {
    return { name() { return `machine${Math.random()}`; } };
}

function fakeChronology() {
    let totalLoaded = 0;
    let totalDispensed = 0;
    return {
        load(amount) { totalLoaded += amount; },
        dispense(amount) { totalDispensed += amount; },
        get() { return { loaded: totalLoaded, dispensed: totalDispensed }; }
    };
}

describe('activeMelting', function() {
    it('returns id when id is called', function() {
        const id = `id${  Math.random()}`;
        const machine = fakeMachine();
        const active = activeMelting(id, machine, new Date(), fakeChronology(), function() {});
        assert(active.id() === id, 'id mismatch');
    });

    it('returns machine when machine is called', function() {
        const machine = fakeMachine();
        const active = activeMelting('m1', machine, new Date(), fakeChronology(), function() {});
        assert(active.machine() === machine, 'machine mismatch');
    });

    it('returns start time when start is called', function() {
        const machine = fakeMachine();
        const start = new Date();
        const active = activeMelting('m1', machine, start, fakeChronology(), function() {});
        assert(active.start() === start, 'start time mismatch');
    });

    it('returns chronology object', function() {
        const chronology = fakeChronology();
        const active = activeMelting('m1', fakeMachine(), new Date(), chronology, function() {});
        assert(active.chronology() === chronology, 'chronology mismatch');
    });

    it('allows load through chronology', function() {
        const chronology = fakeChronology();
        const amount = Math.random() * 500;
        const active = activeMelting('m1', fakeMachine(), new Date(), chronology, function() {});
        active.chronology().load(amount);
        assert(chronology.get().loaded === amount, 'load through chronology failed');
    });

    it('allows dispense through chronology', function() {
        const chronology = fakeChronology();
        const amount = Math.random() * 400;
        const active = activeMelting('m1', fakeMachine(), new Date(), chronology, function() {});
        active.chronology().dispense(amount);
        assert(chronology.get().dispensed === amount, 'dispense through chronology failed');
    });

    it('returns completed melting when stop is called', function() {
        const machine = fakeMachine();
        const active = activeMelting('m1', machine, new Date(), fakeChronology(), function() {});
        assert(active.stop() !== undefined, 'stop did not return completed melting');
    });

    it('returns completed melting with correct id', function() {
        const id = `id${  Math.random()}`;
        const machine = fakeMachine();
        const active = activeMelting(id, machine, new Date(), fakeChronology(), function() {});
        assert(active.stop().id() === id, 'completed melting id mismatch');
    });

    it('returns completed melting with correct machine', function() {
        const machine = fakeMachine();
        const active = activeMelting('m1', machine, new Date(), fakeChronology(), function() {});
        assert(active.stop().machine() === machine, 'completed melting machine mismatch');
    });

    it('returns completed melting with correct start time', function() {
        const machine = fakeMachine();
        const start = new Date();
        const active = activeMelting('m1', machine, start, fakeChronology(), function() {});
        assert(active.stop().start() === start, 'completed melting start time mismatch');
    });

    it('returns completed melting with end time', function() {
        const machine = fakeMachine();
        const active = activeMelting('m1', machine, new Date(), fakeChronology(), function() {});
        assert(active.stop().end() !== undefined, 'completed melting lacks end time');
    });

    it('returns completed melting with chronology', function() {
        const chronology = fakeChronology();
        const loaded = Math.random() * 500;
        const active = activeMelting('m1', fakeMachine(), new Date(), chronology, function() {});
        active.chronology().load(loaded);
        assert(active.stop().chronology().get().loaded === loaded, 'completed melting chronology mismatch');
    });

    it('calls onStop callback when stop is called', function() {
        const machine = fakeMachine();
        let called = false;
        const active = activeMelting('m1', machine, new Date(), fakeChronology(), function() {
            called = true;
        });
        active.stop();
        assert(called === true, 'onStop callback not called');
    });

    it('passes completed melting to onStop callback', function() {
        const id = `id${  Math.random()}`;
        const machine = fakeMachine();
        let received = null;
        const active = activeMelting(id, machine, new Date(), fakeChronology(), function(completed) {
            received = completed;
        });
        active.stop();
        assert(received.id() === id, 'callback did not receive correct completed melting');
    });
});
