import assert from 'assert';
import activeMelting from '../src/activeMelting.js';
import meltingMachine from '../src/meltingMachine.js';

function fakeSensor(value) {
    return { measurements() { return value; } };
}

function fakeAlerts() {
    return { all() { return []; } };
}

function fakeSensors() {
    return { voltage: fakeSensor(0), cosphi: fakeSensor(0) };
}

function createMachine() {
    return meltingMachine(`machine${Math.random()}`, fakeSensors(), fakeAlerts());
}

describe('activeMelting', function() {
    it('returns id when id is called', function() {
        const id = `id${Math.random()}`;
        const machine = createMachine();
        const active = activeMelting(id, machine, new Date(), function() {}, function() {});
        assert(active.id() === id, 'id mismatch');
    });

    it('returns machine when machine is called', function() {
        const machine = createMachine();
        const active = activeMelting('m1', machine, new Date(), function() {}, function() {});
        assert(active.machine() === machine, 'machine mismatch');
    });

    it('returns chronology with start time', function() {
        const machine = createMachine();
        const start = new Date();
        const active = activeMelting('m1', machine, start, function() {}, function() {});
        assert(active.chronology().get().start === start, 'start time mismatch');
    });

    it('returns chronology without end time for active melting', function() {
        const machine = createMachine();
        const active = activeMelting('m1', machine, new Date(), function() {}, function() {});
        assert(active.chronology().get().end === undefined, 'end should be undefined');
    });

    it('returns chronology with current weight from machine', function() {
        const machine = createMachine();
        const amount = Math.random() * 500;
        machine.load(amount);
        const active = activeMelting('m1', machine, new Date(), function() {}, function() {});
        assert(active.chronology().get().weight === amount, 'weight mismatch');
    });

    it('returns completed melting when stop is called', function() {
        const machine = createMachine();
        const active = activeMelting('m1', machine, new Date(), function() {}, function() {});
        assert(active.stop() !== undefined, 'stop did not return completed melting');
    });

    it('returns completed melting with correct id', function() {
        const id = `id${Math.random()}`;
        const machine = createMachine();
        const active = activeMelting(id, machine, new Date(), function() {}, function() {});
        assert(active.stop().id() === id, 'completed melting id mismatch');
    });

    it('returns completed melting with correct machine', function() {
        const machine = createMachine();
        const active = activeMelting('m1', machine, new Date(), function() {}, function() {});
        assert(active.stop().machine() === machine, 'completed melting machine mismatch');
    });

    it('returns completed melting with start time in chronology', function() {
        const machine = createMachine();
        const start = new Date();
        const active = activeMelting('m1', machine, start, function() {}, function() {});
        assert(active.stop().chronology().get().start === start, 'completed start time mismatch');
    });

    it('returns completed melting with end time in chronology', function() {
        const machine = createMachine();
        const active = activeMelting('m1', machine, new Date(), function() {}, function() {});
        assert(active.stop().chronology().get().end !== undefined, 'completed lacks end time');
    });

    it('calls onStop callback when stop is called', function() {
        const machine = createMachine();
        let called = false;
        const active = activeMelting('m1', machine, new Date(), function() { called = true; }, function() {});
        active.stop();
        assert(called === true, 'onStop callback not called');
    });

    it('passes completed melting to onStop callback', function() {
        const id = `id${Math.random()}`;
        const machine = createMachine();
        let received = null;
        const active = activeMelting(id, machine, new Date(), function(completed) { received = completed; }, function() {});
        active.stop();
        assert(received.id() === id, 'callback did not receive correct completed melting');
    });

    it('returns updated melting when update is called', function() {
        const machine = createMachine();
        const active = activeMelting('m1', machine, new Date(), function() {}, function() {});
        const start = new Date(Date.now() - 60000);
        const updated = active.update({ start: start.toISOString() });
        assert(updated.chronology().get().start.getTime() === start.getTime(), 'update start mismatch');
    });

    it('calls onUpdate callback when update is called', function() {
        const machine = createMachine();
        let called = false;
        const active = activeMelting('m1', machine, new Date(), function() {}, function() { called = true; });
        active.update({ start: new Date().toISOString() });
        assert(called === true, 'onUpdate callback not called');
    });

    it('passes updated melting to onUpdate callback', function() {
        const machine = createMachine();
        let received = null;
        const active = activeMelting('m1', machine, new Date(), function() {}, function(updated) { received = updated; });
        const start = new Date(Date.now() - 60000);
        active.update({ start: start.toISOString() });
        assert(received.chronology().get().start.getTime() === start.getTime(), 'callback did not receive updated melting');
    });

    it('update with empty data keeps original start time', function() {
        const machine = createMachine();
        const start = new Date(Date.now() - 60000);
        const active = activeMelting('m1', machine, start, function() {}, function() {});
        const updated = active.update({});
        assert(updated.chronology().get().start.getTime() === start.getTime(), 'start time changed unexpectedly');
    });

    it('update with start only changes start time and stays active', function() {
        const machine = createMachine();
        const active = activeMelting('m1', machine, new Date(), function() {}, function() {});
        const newStart = new Date(Date.now() - 120000);
        const updated = active.update({ start: newStart.toISOString() });
        assert(updated.chronology().get().end === undefined, 'should stay active without end');
    });

    it('update with end transitions to completed melting', function() {
        const machine = createMachine();
        const active = activeMelting('m1', machine, new Date(), function() {}, function() {});
        const end = new Date();
        const updated = active.update({ end: end.toISOString() });
        assert(updated.chronology().get().end !== undefined, 'should have end time after transition');
    });

    it('update with end calls onStop callback', function() {
        const machine = createMachine();
        let stopCalled = false;
        const active = activeMelting('m1', machine, new Date(), function() { stopCalled = true; }, function() {});
        active.update({ end: new Date().toISOString() });
        assert(stopCalled === true, 'onStop should be called on transition');
    });

    it('update with start and end transitions with both values', function() {
        const machine = createMachine();
        const start = new Date(Date.now() - 120000);
        const end = new Date(Date.now() - 60000);
        const active = activeMelting('m1', machine, new Date(), function() {}, function() {});
        const updated = active.update({ start: start.toISOString(), end: end.toISOString() });
        assert(updated.chronology().get().start.getTime() === start.getTime(), 'start mismatch');
    });

    it('update without argument keeps original start time', function() {
        const machine = createMachine();
        const start = new Date(Date.now() - 60000);
        const active = activeMelting('m1', machine, start, function() {}, function() {});
        const updated = active.update();
        assert(updated.chronology().get().start.getTime() === start.getTime(), 'start time changed unexpectedly');
    });
});
