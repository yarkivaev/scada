import assert from 'assert';
import completedMelting from '../src/completedMelting.js';

function fakeChronology(loaded, dispensed) {
    return {
        get() {
            return { loaded, dispensed };
        }
    };
}

function fakeMachine() {
    return { name() { return `machine${Math.random()}`; } };
}

describe('completedMelting', function() {
    it('returns id when id is called', function() {
        const id = `id${Math.random()}`;
        const chronology = fakeChronology(0, 0);
        const completed = completedMelting(id, fakeMachine(), new Date(), new Date(), chronology);
        assert(completed.id() === id, 'id mismatch');
    });

    it('returns machine when machine is called', function() {
        const machine = fakeMachine();
        const chronology = fakeChronology(0, 0);
        const completed = completedMelting('m1', machine, new Date(), new Date(), chronology);
        assert(completed.machine() === machine, 'machine mismatch');
    });

    it('returns start time when start is called', function() {
        const start = new Date();
        const chronology = fakeChronology(0, 0);
        const completed = completedMelting('m1', fakeMachine(), start, new Date(), chronology);
        assert(completed.start() === start, 'start time mismatch');
    });

    it('returns end time when end is called', function() {
        const end = new Date();
        const chronology = fakeChronology(0, 0);
        const completed = completedMelting('m1', fakeMachine(), new Date(), end, chronology);
        assert(completed.end() === end, 'end time mismatch');
    });

    it('returns chronology object', function() {
        const chronology = fakeChronology(0, 0);
        const completed = completedMelting('m1', fakeMachine(), new Date(), new Date(), chronology);
        assert(completed.chronology() === chronology, 'chronology mismatch');
    });

    it('returns loaded amount through chronology', function() {
        const loaded = Math.random() * 500;
        const chronology = fakeChronology(loaded, 0);
        const completed = completedMelting('m1', fakeMachine(), new Date(), new Date(), chronology);
        assert(completed.chronology().get().loaded === loaded, 'loaded amount mismatch');
    });

    it('returns dispensed amount through chronology', function() {
        const dispensed = Math.random() * 400;
        const chronology = fakeChronology(0, dispensed);
        const completed = completedMelting('m1', fakeMachine(), new Date(), new Date(), chronology);
        assert(completed.chronology().get().dispensed === dispensed, 'dispensed amount mismatch');
    });
});
