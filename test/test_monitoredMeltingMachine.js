import assert from 'assert';
import monitoredMeltingMachine from '../src/monitoredMeltingMachine.js';

function fakeMachine(name, measurements, alerts) {
    return {
        name() {
            return name;
        },
        measurements() {
            return measurements;
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
        const machine = fakeMachine(name, {}, []);
        const engine = fakeRuleEngine();
        const int = fakeInterval();
        const monitored = monitoredMeltingMachine(machine, engine, int.capture);
        assert(monitored.name() === name);
    });

    it('returns measurements from machine', function() {
        const data = { voltage: Math.random(), cosphi: Math.random() };
        const machine = fakeMachine('m1', data, []);
        const engine = fakeRuleEngine();
        const int = fakeInterval();
        const monitored = monitoredMeltingMachine(machine, engine, int.capture);
        assert(monitored.measurements().voltage === data.voltage);
    });

    it('passes range to machine measurements', function() {
        let received = null;
        const machine = {
            name() { return 'm1'; },
            measurements(range) {
                received = range;
                return {};
            },
            alerts() { return []; }
        };
        const engine = fakeRuleEngine();
        const int = fakeInterval();
        const monitored = monitoredMeltingMachine(machine, engine, int.capture);
        const range = { start: new Date(), end: new Date() };
        monitored.measurements(range);
        assert(received === range);
    });

    it('returns alerts from machine', function() {
        const alerts = [{ message: `alert${  Math.random()}` }];
        const machine = fakeMachine('m1', {}, alerts);
        const engine = fakeRuleEngine();
        const int = fakeInterval();
        const monitored = monitoredMeltingMachine(machine, engine, int.capture);
        assert(monitored.alerts()[0].message === alerts[0].message);
    });

    it('starts interval when init is called', function() {
        const machine = fakeMachine('m1', {}, []);
        const engine = fakeRuleEngine();
        const int = fakeInterval();
        const monitored = monitoredMeltingMachine(machine, engine, int.capture);
        monitored.init();
        assert(int.started === true);
    });

    it('calls ruleEngine evaluate with measurements', function() {
        const data = { voltage: Math.random(), cosphi: Math.random() };
        const machine = fakeMachine('m1', data, []);
        const engine = fakeRuleEngine();
        const int = fakeInterval();
        const monitored = monitoredMeltingMachine(machine, engine, int.capture);
        monitored.init();
        int.callback();
        assert(engine.evaluated.voltage === data.voltage);
    });
});
