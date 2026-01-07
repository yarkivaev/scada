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

function fakeSensors(voltage, cosphi) {
    return { voltage, cosphi };
}

describe('meltingMachine', function() {
    it('returns name when name is called', function() {
        const id = `machine${Math.random()}`;
        const machine = meltingMachine(id, fakeSensors(fakeSensor(0), fakeSensor(0)), fakeAlerts([]));
        assert(machine.name() === id);
    });

    it('exposes voltage sensor in sensors', function() {
        const voltage = fakeSensor(Math.random());
        const machine = meltingMachine('m1', fakeSensors(voltage, fakeSensor(0)), fakeAlerts([]));
        assert(machine.sensors.voltage === voltage);
    });

    it('exposes cosphi sensor in sensors', function() {
        const cosphi = fakeSensor(Math.random());
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(0), cosphi), fakeAlerts([]));
        assert(machine.sensors.cosphi === cosphi);
    });

    it('returns voltage measurements through sensors', function() {
        const value = Math.random();
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(value), fakeSensor(0)), fakeAlerts([]));
        assert(machine.sensors.voltage.measurements() === value);
    });

    it('returns cosphi measurements through sensors', function() {
        const value = Math.random();
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(0), fakeSensor(value)), fakeAlerts([]));
        assert(machine.sensors.cosphi.measurements() === value);
    });

    it('returns zero weight initially', function() {
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(0), fakeSensor(0)), fakeAlerts([]));
        assert(machine.weight() === 0);
    });

    it('increases weight when load is called', function() {
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(0), fakeSensor(0)), fakeAlerts([]));
        const amount = Math.floor(Math.random() * 1000);
        machine.load(amount);
        assert(machine.weight() === amount);
    });

    it('decreases weight when dispense is called', function() {
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(0), fakeSensor(0)), fakeAlerts([]));
        machine.load(100);
        const amount = Math.floor(Math.random() * 50);
        machine.dispense(amount);
        assert(machine.weight() === 100 - amount);
    });

    it('accumulates weight across multiple loads', function() {
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(0), fakeSensor(0)), fakeAlerts([]));
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
        const machine = meltingMachine(id, fakeSensors(fakeSensor(0), fakeSensor(0)), fakeAlerts(items));
        assert(machine.alerts().length === 2);
    });

    it('returns empty alerts when no matching alerts exist', function() {
        const items = [{ object: 'other', message: 'alert' }];
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(0), fakeSensor(0)), fakeAlerts(items));
        assert(machine.alerts().length === 0);
    });
});
