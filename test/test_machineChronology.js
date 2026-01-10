import assert from 'assert';
import machineChronology from '../src/machineChronology.js';

describe('machineChronology', function() {
    it('returns current weight from last history entry', function() {
        const weight = Math.random() * 1000;
        const history = [{ timestamp: new Date(), weight }];
        const chron = machineChronology(0, history);
        assert(chron.get().weight === weight, 'current weight mismatch');
    });

    it('returns initial weight when history has only initial entry', function() {
        const initial = Math.random() * 1000;
        const history = [{ timestamp: new Date(), weight: initial }];
        const chron = machineChronology(initial, history);
        assert(chron.get().weight === initial, 'initial weight mismatch');
    });

    it('returns historical weight at specific datetime', function() {
        const past = new Date(Date.now() - 60000);
        const now = new Date();
        const history = [
            { timestamp: past, weight: 100 },
            { timestamp: now, weight: 200 }
        ];
        const chron = machineChronology(0, history);
        assert(chron.get(past).weight === 100, 'historical weight mismatch');
    });

    it('returns initial when querying before first entry', function() {
        const initial = Math.random() * 500;
        const later = new Date(Date.now() + 60000);
        const history = [{ timestamp: later, weight: 100 }];
        const chron = machineChronology(initial, history);
        const before = new Date(Date.now() - 60000);
        assert(chron.get(before).weight === initial, 'should return initial before first entry');
    });

    it('returns most recent weight at or before queried time', function() {
        const base = Date.now();
        const history = [
            { timestamp: new Date(base - 3000), weight: 100 },
            { timestamp: new Date(base - 2000), weight: 200 },
            { timestamp: new Date(base - 1000), weight: 300 }
        ];
        const chron = machineChronology(0, history);
        const query = new Date(base - 1500);
        assert(chron.get(query).weight === 200, 'should return weight at or before query time');
    });

    it('reflects updates to shared history array', function() {
        const history = [{ timestamp: new Date(), weight: 100 }];
        const chron = machineChronology(100, history);
        const weight = Math.random() * 500;
        history.push({ timestamp: new Date(), weight });
        assert(chron.get().weight === weight, 'should reflect history updates');
    });
});
