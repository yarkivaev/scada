import assert from 'assert';
import meltingMachine from '../src/meltingMachine.js';

function fakeSensor(value) {
    return {
        measurements() {
            return value;
        },
        current() {
            return Promise.resolve({ value, unit: '', timestamp: new Date() });
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
        assert(machine.name() === id, 'name mismatch');
    });

    it('exposes voltage sensor in sensors', function() {
        const voltage = fakeSensor(Math.random());
        const machine = meltingMachine('m1', fakeSensors(voltage, fakeSensor(0)), fakeAlerts([]));
        assert(machine.sensors.voltage === voltage, 'voltage sensor mismatch');
    });

    it('exposes cosphi sensor in sensors', function() {
        const cosphi = fakeSensor(Math.random());
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(0), cosphi), fakeAlerts([]));
        assert(machine.sensors.cosphi === cosphi, 'cosphi sensor mismatch');
    });

    it('returns voltage measurements through sensors', function() {
        const value = Math.random();
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(value), fakeSensor(0)), fakeAlerts([]));
        assert(machine.sensors.voltage.measurements() === value, 'voltage measurements mismatch');
    });

    it('returns cosphi measurements through sensors', function() {
        const value = Math.random();
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(0), fakeSensor(value)), fakeAlerts([]));
        assert(machine.sensors.cosphi.measurements() === value, 'cosphi measurements mismatch');
    });

    it('returns zero weight from chronology initially', async function() {
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(0), fakeSensor(0)), fakeAlerts([]));
        const result = await machine.chronology().get({ type: 'current' });
        assert(result.weight === 0, 'initial weight not zero');
    });

    it('returns initial weight from chronology when provided', async function() {
        const initial = Math.random() * 1000;
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(0), fakeSensor(0)), fakeAlerts([]), initial);
        const result = await machine.chronology().get({ type: 'current' });
        assert(result.weight === initial, 'initial weight mismatch');
    });

    it('increases weight in chronology when load is called', async function() {
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(0), fakeSensor(0)), fakeAlerts([]));
        const amount = Math.floor(Math.random() * 1000);
        machine.load(amount);
        const result = await machine.chronology().get({ type: 'current' });
        assert(result.weight === amount, 'weight after load mismatch');
    });

    it('decreases weight in chronology when dispense is called', async function() {
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(0), fakeSensor(0)), fakeAlerts([]));
        machine.load(100);
        const amount = Math.floor(Math.random() * 50);
        machine.dispense(amount);
        const result = await machine.chronology().get({ type: 'current' });
        assert(result.weight === 100 - amount, 'weight after dispense mismatch');
    });

    it('accumulates weight across multiple loads in chronology', async function() {
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(0), fakeSensor(0)), fakeAlerts([]));
        machine.load(100);
        machine.load(50);
        const result = await machine.chronology().get({ type: 'current' });
        assert(result.weight === 150, 'accumulated weight mismatch');
    });

    it('returns historical weight from chronology at specific time', function() {
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(0), fakeSensor(0)), fakeAlerts([]));
        const before = new Date(Date.now() - 1000);
        machine.load(100);
        assert(machine.chronology().get({ type: 'point', at: before }).weight === 0, 'historical weight before load mismatch');
    });

    it('returns alerts filtered by machine name', function() {
        const id = `machine${Math.random()}`;
        const items = [
            { object: id, message: 'alert1' },
            { object: 'other', message: 'alert2' },
            { object: id, message: 'alert3' }
        ];
        const machine = meltingMachine(id, fakeSensors(fakeSensor(0), fakeSensor(0)), fakeAlerts(items));
        assert(machine.alerts().length === 2, 'filtered alerts count mismatch');
    });

    it('returns empty alerts when no matching alerts exist', function() {
        const items = [{ object: 'other', message: 'alert' }];
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(0), fakeSensor(0)), fakeAlerts(items));
        assert(machine.alerts().length === 0, 'should return empty alerts');
    });

    it('returns self when init is called', function() {
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(0), fakeSensor(0)), fakeAlerts([]));
        assert(machine.init() === machine, 'init should return self');
    });

    it('sets weight in chronology when reset is called', async function() {
        const machine = meltingMachine('m1', fakeSensors(fakeSensor(0), fakeSensor(0)), fakeAlerts([]));
        machine.load(100);
        const amount = Math.floor(Math.random() * 500);
        machine.reset(amount);
        const result = await machine.chronology().get({ type: 'current' });
        assert(result.weight === amount, 'weight after reset mismatch');
    });
});
