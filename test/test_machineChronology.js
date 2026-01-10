import assert from 'assert';
import machineChronology from '../src/machineChronology.js';

describe('machineChronology', function() {
    it('returns current weight from last history entry', function() {
        const weight = Math.random() * 1000;
        const history = [{ timestamp: new Date(), weight }];
        const chron = machineChronology(0, history);
        assert(chron.get({ type: 'current' }).weight === weight, 'current weight mismatch');
    });

    it('returns initial weight when history has only initial entry', function() {
        const initial = Math.random() * 1000;
        const history = [{ timestamp: new Date(), weight: initial }];
        const chron = machineChronology(initial, history);
        assert(chron.get({ type: 'current' }).weight === initial, 'initial weight mismatch');
    });

    it('returns historical weight at specific datetime', function() {
        const past = new Date(Date.now() - 60000);
        const now = new Date();
        const history = [
            { timestamp: past, weight: 100 },
            { timestamp: now, weight: 200 }
        ];
        const chron = machineChronology(0, history);
        assert(chron.get({ type: 'point', at: past }).weight === 100, 'historical weight mismatch');
    });

    it('returns initial when querying before first entry', function() {
        const initial = Math.random() * 500;
        const later = new Date(Date.now() + 60000);
        const history = [{ timestamp: later, weight: 100 }];
        const chron = machineChronology(initial, history);
        const before = new Date(Date.now() - 60000);
        assert(chron.get({ type: 'point', at: before }).weight === initial, 'should return initial before first entry');
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
        assert(chron.get({ type: 'point', at: query }).weight === 200, 'should return weight at or before query time');
    });

    it('reflects updates to shared history array', function() {
        const history = [{ timestamp: new Date(), weight: 100 }];
        const chron = machineChronology(100, history);
        const weight = Math.random() * 500;
        history.push({ timestamp: new Date(), weight });
        assert(chron.get({ type: 'current' }).weight === weight, 'should reflect history updates');
    });

    it('returns loaded and dispensed for range query', function() {
        const base = Date.now();
        const history = [
            { timestamp: new Date(base - 4000), weight: 0 },
            { timestamp: new Date(base - 3000), weight: 500 },
            { timestamp: new Date(base - 2000), weight: 20 }
        ];
        const chron = machineChronology(0, history);
        const result = chron.get({ type: 'range', from: new Date(base - 4000), to: new Date(base - 1000) });
        assert(result.loaded === 500, 'loaded mismatch');
        assert(result.dispensed === 480, 'dispensed mismatch');
    });

    it('returns zero loaded and dispensed for empty range', function() {
        const base = Date.now();
        const history = [{ timestamp: new Date(base), weight: 100 }];
        const chron = machineChronology(100, history);
        const result = chron.get({ type: 'range', from: new Date(base - 2000), to: new Date(base - 1000) });
        assert(result.loaded === 0, 'loaded should be zero');
        assert(result.dispensed === 0, 'dispensed should be zero');
    });

    it('excludes end timestamp from range query', function() {
        const base = Date.now();
        const history = [
            { timestamp: new Date(base - 3000), weight: 0 },
            { timestamp: new Date(base - 2000), weight: 100 },
            { timestamp: new Date(base - 1000), weight: 200 }
        ];
        const chron = machineChronology(0, history);
        const result = chron.get({ type: 'range', from: new Date(base - 3000), to: new Date(base - 1000) });
        assert(result.loaded === 100, 'should exclude entry at end timestamp');
    });

    it('calculates loaded from multiple consecutive loads', function() {
        const base = Date.now();
        const history = [
            { timestamp: new Date(base - 4000), weight: 0 },
            { timestamp: new Date(base - 3000), weight: 100 },
            { timestamp: new Date(base - 2000), weight: 250 },
            { timestamp: new Date(base - 1000), weight: 400 }
        ];
        const chron = machineChronology(0, history);
        const result = chron.get({ type: 'range', from: new Date(base - 4000), to: new Date(base) });
        assert(result.loaded === 400, 'should sum consecutive loads');
        assert(result.dispensed === 0, 'no dispensing occurred');
    });

    it('calculates dispensed from multiple consecutive dispenses', function() {
        const base = Date.now();
        const history = [
            { timestamp: new Date(base - 4000), weight: 500 },
            { timestamp: new Date(base - 3000), weight: 400 },
            { timestamp: new Date(base - 2000), weight: 250 },
            { timestamp: new Date(base - 1000), weight: 50 }
        ];
        const chron = machineChronology(500, history);
        const result = chron.get({ type: 'range', from: new Date(base - 4000), to: new Date(base) });
        assert(result.loaded === 0, 'no loading occurred');
        assert(result.dispensed === 450, 'should sum consecutive dispenses');
    });

    it('throws when unknown query type is provided', function() {
        const history = [{ timestamp: new Date(), weight: 100 }];
        const chron = machineChronology(0, history);
        const type = `unknown_${Math.random()}`;
        let thrown = false;
        try {
            chron.get({ type });
        } catch {
            thrown = true;
        }
        assert(thrown === true, 'did not throw for unknown query type');
    });
});
