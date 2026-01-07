import assert from 'assert';
import monitoredMeltingMachine from '../src/monitoredMeltingMachine.js';

function fakeSensor(value) {
    return {
        measurements() {
            return value;
        }
    };
}

function fakeMachine(name, voltageValue, cosphiValue, alerts) {
    return {
        name() {
            return name;
        },
        sensors: {
            voltage: fakeSensor(voltageValue),
            cosphi: fakeSensor(cosphiValue)
        },
        alerts() {
            return alerts;
        }
    };
}

function fakeRuleEngine() {
    return {
        evaluated: null,
        evaluate(snapshot) {
            this.evaluated = snapshot;
        }
    };
}

function fakeInterval() {
    const state = {
        callback: null,
        started: false
    };
    state.capture = function(ms, cb) {
        state.callback = cb;
        return {
            start() {
                state.started = true;
            }
        };
    };
    return state;
}

describe('monitoredMeltingMachine', function() {
    it('returns name from machine', function() {
        const name = `machine${  Math.random()}`;
        const machine = fakeMachine(name, 0, 0, []);
        const engine = fakeRuleEngine();
        const int = fakeInterval();
        const monitored = monitoredMeltingMachine(machine, engine, int.capture);
        assert(monitored.name() === name);
    });

    it('exposes sensors from machine', function() {
        const machine = fakeMachine('m1', 0, 0, []);
        const engine = fakeRuleEngine();
        const int = fakeInterval();
        const monitored = monitoredMeltingMachine(machine, engine, int.capture);
        assert(monitored.sensors === machine.sensors);
    });

    it('returns voltage measurements through sensors', function() {
        const voltage = Math.random();
        const machine = fakeMachine('m1', voltage, 0, []);
        const engine = fakeRuleEngine();
        const int = fakeInterval();
        const monitored = monitoredMeltingMachine(machine, engine, int.capture);
        assert(monitored.sensors.voltage.measurements() === voltage);
    });

    it('returns alerts from machine', function() {
        const alerts = [{ message: `alert${  Math.random()}` }];
        const machine = fakeMachine('m1', 0, 0, alerts);
        const engine = fakeRuleEngine();
        const int = fakeInterval();
        const monitored = monitoredMeltingMachine(machine, engine, int.capture);
        assert(monitored.alerts()[0].message === alerts[0].message);
    });

    it('starts interval when init is called', function() {
        const machine = fakeMachine('m1', 0, 0, []);
        const engine = fakeRuleEngine();
        const int = fakeInterval();
        const monitored = monitoredMeltingMachine(machine, engine, int.capture);
        monitored.init();
        assert(int.started === true);
    });

    it('calls ruleEngine evaluate with measurements', function() {
        const voltage = Math.random();
        const cosphi = Math.random();
        const machine = fakeMachine('m1', voltage, cosphi, []);
        const engine = fakeRuleEngine();
        const int = fakeInterval();
        monitoredMeltingMachine(machine, engine, int.capture).init();
        int.callback();
        assert(engine.evaluated.voltage === voltage);
    });
});
