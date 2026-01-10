import assert from 'assert';
import meltingChronology from '../src/meltingChronology.js';
import machineChronology from '../src/machineChronology.js';

function fakeMachine(initial, history) {
    return {
        chronology() {
            return machineChronology(initial, history);
        }
    };
}

describe('meltingChronology', function() {
    it('returns start time in get result', function() {
        const start = new Date();
        const history = [{ timestamp: start, weight: 0 }];
        const machine = fakeMachine(0, history);
        const chron = meltingChronology(machine, start, undefined);
        assert(chron.get().start === start, 'start time mismatch');
    });

    it('returns end time in get result when provided', function() {
        const start = new Date();
        const end = new Date();
        const history = [{ timestamp: start, weight: 0 }];
        const machine = fakeMachine(0, history);
        const chron = meltingChronology(machine, start, end);
        assert(chron.get().end === end, 'end time mismatch');
    });

    it('omits end from get result when undefined', function() {
        const history = [{ timestamp: new Date(), weight: 0 }];
        const machine = fakeMachine(0, history);
        const chron = meltingChronology(machine, new Date(), undefined);
        assert(chron.get().end === undefined, 'end should be undefined');
    });

    it('returns initial weight from machine at start time', function() {
        const initial = Math.random() * 1000;
        const start = new Date();
        const history = [{ timestamp: start, weight: initial }];
        const machine = fakeMachine(initial, history);
        const chron = meltingChronology(machine, start, undefined);
        assert(chron.get().initial === initial, 'initial weight mismatch');
    });

    it('returns current weight from machine', function() {
        const base = Date.now();
        const start = new Date(base - 2000);
        const loadTime = new Date(base - 1000);
        const amount = Math.random() * 500;
        const history = [
            { timestamp: start, weight: 0 },
            { timestamp: loadTime, weight: amount }
        ];
        const machine = fakeMachine(0, history);
        const chron = meltingChronology(machine, start, undefined);
        assert(chron.get().weight === amount, 'current weight mismatch');
    });

    it('returns weight at end time for completed melting', function() {
        const base = Date.now();
        const start = new Date(base - 3000);
        const loadTime = new Date(base - 2000);
        const end = new Date(base - 1000);
        const laterTime = new Date(base);
        const history = [
            { timestamp: start, weight: 0 },
            { timestamp: loadTime, weight: 100 },
            { timestamp: laterTime, weight: 150 }
        ];
        const machine = fakeMachine(0, history);
        const chron = meltingChronology(machine, start, end);
        assert(chron.get().weight === 100, 'weight at end mismatch');
    });

    it('returns weight at specific datetime when queried', function() {
        const base = Date.now();
        const start = new Date(base - 3000);
        const loadTime = new Date(base - 2000);
        const middle = new Date(base - 1000);
        const laterTime = new Date(base);
        const history = [
            { timestamp: start, weight: 0 },
            { timestamp: loadTime, weight: 100 },
            { timestamp: laterTime, weight: 150 }
        ];
        const machine = fakeMachine(0, history);
        const chron = meltingChronology(machine, start, undefined);
        assert(chron.get(middle).weight === 100, 'weight at query time mismatch');
    });

    it('returns initial at start time for active melting', function() {
        const initial = Math.random() * 100;
        const base = Date.now();
        const start = new Date(base - 2000);
        const loadTime = new Date(base - 1000);
        const history = [
            { timestamp: start, weight: initial },
            { timestamp: loadTime, weight: initial + 50 }
        ];
        const machine = fakeMachine(initial, history);
        const chron = meltingChronology(machine, start, undefined);
        assert(chron.get().initial === initial, 'initial at start mismatch');
    });
});
