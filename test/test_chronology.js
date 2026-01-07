import assert from 'assert';
import chronology from '../src/chronology.js';

describe('chronology', function() {
    it('returns initial weight when no events', function() {
        const initial = Math.random() * 1000;
        const history = chronology(initial);
        assert(history.get().initial === initial, 'initial weight mismatch');
    });

    it('returns zero loaded when no load events', function() {
        const history = chronology(Math.random() * 1000);
        assert(history.get().loaded === 0, 'loaded should be zero');
    });

    it('returns zero dispensed when no dispense events', function() {
        const history = chronology(Math.random() * 1000);
        assert(history.get().dispensed === 0, 'dispensed should be zero');
    });

    it('returns initial as weight when no events', function() {
        const initial = Math.random() * 1000;
        const history = chronology(initial);
        assert(history.get().weight === initial, 'weight should equal initial');
    });

    it('accumulates loaded amount', function() {
        const history = chronology(0);
        const amount = Math.random() * 500;
        history.load(amount);
        assert(history.get().loaded === amount, 'loaded amount mismatch');
    });

    it('accumulates multiple load events', function() {
        const history = chronology(0);
        const first = Math.random() * 500;
        const second = Math.random() * 500;
        history.load(first);
        history.load(second);
        assert(history.get().loaded === first + second, 'total loaded mismatch');
    });

    it('accumulates dispensed amount', function() {
        const history = chronology(0);
        const amount = Math.random() * 500;
        history.dispense(amount);
        assert(history.get().dispensed === amount, 'dispensed amount mismatch');
    });

    it('accumulates multiple dispense events', function() {
        const history = chronology(0);
        const first = Math.random() * 500;
        const second = Math.random() * 500;
        history.dispense(first);
        history.dispense(second);
        assert(history.get().dispensed === first + second, 'total dispensed mismatch');
    });

    it('calculates weight as initial plus loaded minus dispensed', function() {
        const initial = Math.random() * 100;
        const loaded = Math.random() * 500;
        const dispensed = Math.random() * 400;
        const history = chronology(initial);
        history.load(loaded);
        history.dispense(dispensed);
        const expected = initial + loaded - dispensed;
        assert(history.get().weight === expected, 'weight calculation incorrect');
    });

    it('returns all values in get result', function() {
        const initial = Math.random() * 100;
        const loaded = Math.random() * 500;
        const dispensed = Math.random() * 400;
        const history = chronology(initial);
        history.load(loaded);
        history.dispense(dispensed);
        const result = history.get();
        assert(result.initial === initial, 'initial missing from result');
    });
});
