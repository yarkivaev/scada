import assert from 'assert';
import completedMelting from '../src/completedMelting.js';
import meltingChronology from '../src/meltingChronology.js';
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

describe('completedMelting', function() {
    it('returns id when id is called', function() {
        const id = `id${Math.random()}`;
        const machine = createMachine();
        const chron = meltingChronology(machine, new Date(), new Date());
        const completed = completedMelting(id, machine, chron, function() {});
        assert(completed.id() === id, 'id mismatch');
    });

    it('returns machine when machine is called', function() {
        const machine = createMachine();
        const chron = meltingChronology(machine, new Date(), new Date());
        const completed = completedMelting('m1', machine, chron, function() {});
        assert(completed.machine() === machine, 'machine mismatch');
    });

    it('returns chronology object', function() {
        const machine = createMachine();
        const chron = meltingChronology(machine, new Date(), new Date());
        const completed = completedMelting('m1', machine, chron, function() {});
        assert(completed.chronology() === chron, 'chronology mismatch');
    });

    it('returns start time through chronology', function() {
        const machine = createMachine();
        const start = new Date();
        const chron = meltingChronology(machine, start, new Date());
        const completed = completedMelting('m1', machine, chron, function() {});
        assert(completed.chronology().get().start === start, 'start time mismatch');
    });

    it('returns end time through chronology', function() {
        const machine = createMachine();
        const end = new Date();
        const chron = meltingChronology(machine, new Date(), end);
        const completed = completedMelting('m1', machine, chron, function() {});
        assert(completed.chronology().get().end === end, 'end time mismatch');
    });

    it('returns weight through chronology', function() {
        const machine = createMachine();
        const amount = Math.random() * 500;
        machine.load(amount);
        const start = new Date();
        const end = new Date();
        const chron = meltingChronology(machine, start, end);
        const completed = completedMelting('m1', machine, chron, function() {});
        assert(completed.chronology().get().weight === amount, 'weight mismatch');
    });

    it('returns updated melting when update is called', function() {
        const machine = createMachine();
        const chron = meltingChronology(machine, new Date(), new Date());
        const completed = completedMelting('m1', machine, chron, function() {});
        const start = new Date(Date.now() - 60000);
        const end = new Date();
        const updated = completed.update({ start: start.toISOString(), end: end.toISOString() });
        assert(updated.chronology().get().start.getTime() === start.getTime(), 'update start mismatch');
    });

    it('calls onUpdate callback when update is called', function() {
        const machine = createMachine();
        const chron = meltingChronology(machine, new Date(), new Date());
        let called = false;
        const completed = completedMelting('m1', machine, chron, function() { called = true; });
        completed.update({ start: new Date().toISOString(), end: new Date().toISOString() });
        assert(called === true, 'onUpdate callback not called');
    });

    it('passes updated melting to onUpdate callback', function() {
        const machine = createMachine();
        const chron = meltingChronology(machine, new Date(), new Date());
        let received = null;
        const completed = completedMelting('m1', machine, chron, function(updated) { received = updated; });
        const start = new Date(Date.now() - 60000);
        completed.update({ start: start.toISOString(), end: new Date().toISOString() });
        assert(received.chronology().get().start.getTime() === start.getTime(), 'callback did not receive updated melting');
    });

    it('update with empty data keeps original times', function() {
        const machine = createMachine();
        const start = new Date(Date.now() - 120000);
        const end = new Date(Date.now() - 60000);
        const chron = meltingChronology(machine, start, end);
        const completed = completedMelting('m1', machine, chron, function() {});
        const updated = completed.update({});
        assert(updated.chronology().get().start.getTime() === start.getTime(), 'start changed unexpectedly');
    });

    it('update with start only preserves end time', function() {
        const machine = createMachine();
        const start = new Date(Date.now() - 120000);
        const end = new Date(Date.now() - 60000);
        const chron = meltingChronology(machine, start, end);
        const completed = completedMelting('m1', machine, chron, function() {});
        const newStart = new Date(Date.now() - 180000);
        const updated = completed.update({ start: newStart.toISOString() });
        assert(updated.chronology().get().end.getTime() === end.getTime(), 'end changed unexpectedly');
    });

    it('update with end only preserves start time', function() {
        const machine = createMachine();
        const start = new Date(Date.now() - 120000);
        const end = new Date(Date.now() - 60000);
        const chron = meltingChronology(machine, start, end);
        const completed = completedMelting('m1', machine, chron, function() {});
        const newEnd = new Date(Date.now() - 30000);
        const updated = completed.update({ end: newEnd.toISOString() });
        assert(updated.chronology().get().start.getTime() === start.getTime(), 'start changed unexpectedly');
    });

    it('update without argument keeps original times', function() {
        const machine = createMachine();
        const start = new Date(Date.now() - 120000);
        const end = new Date(Date.now() - 60000);
        const chron = meltingChronology(machine, start, end);
        const completed = completedMelting('m1', machine, chron, function() {});
        const updated = completed.update();
        assert(updated.chronology().get().start.getTime() === start.getTime(), 'start changed unexpectedly');
    });
});
