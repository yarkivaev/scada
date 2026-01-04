import assert from 'assert';
import meltingMachine from '../src/meltingMachine.js';

function fakeSensor(value) {
    return {
        measurements() {
            return value;
        }
    };
}

function fakeAlerts(items) {
    return {
        all(filter) {
            return items.filter(filter);
        }
    };
}

describe('meltingMachine', function() {
    it('returns name when name is called', function() {
        const id = `machine${Math.random()}`;
        const machine = meltingMachine(id, fakeSensor(0), fakeSensor(0), fakeAlerts([]));
        assert(machine.name() === id);
    });

    it('returns voltage from sensor in measurements', function() {
        const voltage = Math.random();
        const machine = meltingMachine('m1', fakeSensor(voltage), fakeSensor(0), fakeAlerts([]));
        assert(machine.measurements().voltage === voltage);
    });

    it('returns cosphi from sensor in measurements', function() {
        const cosphi = Math.random();
        const machine = meltingMachine('m1', fakeSensor(0), fakeSensor(cosphi), fakeAlerts([]));
        assert(machine.measurements().cosphi === cosphi);
    });

    it('passes range to voltage sensor', function() {
        let received = null;
        const sensor = {
            measurements(range) {
                received = range;
                return 0;
            }
        };
        const machine = meltingMachine('m1', sensor, fakeSensor(0), fakeAlerts([]));
        const range = { start: new Date(), end: new Date() };
        machine.measurements(range);
        assert(received === range);
    });

    it('passes range to cosphi sensor', function() {
        let received = null;
        const sensor = {
            measurements(range) {
                received = range;
                return 0;
            }
        };
        const machine = meltingMachine('m1', fakeSensor(0), sensor, fakeAlerts([]));
        const range = { start: new Date(), end: new Date() };
        machine.measurements(range);
        assert(received === range);
    });

    it('returns zero weight initially', function() {
        const machine = meltingMachine('m1', fakeSensor(0), fakeSensor(0), fakeAlerts([]));
        assert(machine.weight() === 0);
    });

    it('increases weight when load is called', function() {
        const machine = meltingMachine('m1', fakeSensor(0), fakeSensor(0), fakeAlerts([]));
        const amount = Math.floor(Math.random() * 1000);
        machine.load(amount);
        assert(machine.weight() === amount);
    });

    it('decreases weight when dispense is called', function() {
        const machine = meltingMachine('m1', fakeSensor(0), fakeSensor(0), fakeAlerts([]));
        machine.load(100);
        const amount = Math.floor(Math.random() * 50);
        machine.dispense(amount);
        assert(machine.weight() === 100 - amount);
    });

    it('accumulates weight across multiple loads', function() {
        const machine = meltingMachine('m1', fakeSensor(0), fakeSensor(0), fakeAlerts([]));
        machine.load(100);
        machine.load(50);
        assert(machine.weight() === 150);
    });

    it('returns alerts filtered by machine name', function() {
        const id = `machine${Math.random()}`;
        const items = [
            { object: id, message: 'alert1' },
            { object: 'other', message: 'alert2' },
            { object: id, message: 'alert3' }
        ];
        const machine = meltingMachine(id, fakeSensor(0), fakeSensor(0), fakeAlerts(items));
        assert(machine.alerts().length === 2);
    });

    it('returns empty alerts when no matching alerts exist', function() {
        const items = [{ object: 'other', message: 'alert' }];
        const machine = meltingMachine('m1', fakeSensor(0), fakeSensor(0), fakeAlerts(items));
        assert(machine.alerts().length === 0);
    });
});
