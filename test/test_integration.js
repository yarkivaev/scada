import assert from 'assert';
import plant from '../src/plant.js';
import meltingShop from '../src/meltingShop.js';
import meltingMachine from '../src/meltingMachine.js';
import meltings from '../src/meltings.js';
import alerts from '../src/alerts.js';
import { acknowledgedAlert, alert } from '../src/alert.js';
import events from '../src/events.js';
import event from '../src/event.js';
import rule from '../src/rule.js';
import rules from '../src/rules.js';
import initialized from '../src/initialized.js';

function fakeInitialized() {
    return {
        init() {},
        get() {
            return {};
        }
    };
}

function fakeAlerts() {
    return {
        items: [],
        all() {
            return this.items;
        },
        stream() {
            return { cancel() {} };
        }
    };
}

describe('integration', function() {
    it('constructs full plant hierarchy with events and rules', function() {
        const history = alerts(alert, acknowledgedAlert);
        const rs = rules([]);
        const log = events(event, rs);
        const shop = meltingShop(`s-${Math.random()}`, fakeInitialized(), meltings(), history, log);
        const p = plant(initialized({ s1: shop }, Object.values), log);
        assert(p.shops.get().s1 === shop, 'shop not accessible from plant');
    });

    it('shares single events instance between plant and shop', function() {
        const log = events(event, rules([]));
        const shop = meltingShop(`s-${Math.random()}`, fakeInitialized(), meltings(), fakeAlerts(), log);
        const p = plant(initialized({ s1: shop }, Object.values), log);
        assert(p.events === p.shops.get().s1.events, 'plant and shop should share events');
    });

    it('automatically triggers alert when critical event created', function() {
        const history = alerts(alert, acknowledgedAlert);
        const rs = rules([
            rule(
                (ctx) => {return ctx.event && ctx.event.labels().includes('critical')},
                (ctx) => {history.trigger(`Critical event for ${ctx.event.properties().machine}`, new Date(), ctx.event.properties().machine, ctx.event)}
            )
        ]);
        const log = events(event, rs);
        const p = plant(fakeInitialized(), log);
        p.events.create(new Date(), { machine: `m-${Math.random()}` }, ['critical']);
        assert(history.all().length === 1, 'alert was not triggered automatically');
    });

    it('triggered alert references source event', function() {
        const history = alerts(alert, acknowledgedAlert);
        const rs = rules([
            rule(
                (ctx) => {return ctx.event && ctx.event.labels().includes('test')},
                (ctx) => {history.trigger('Test', new Date(), 'obj', ctx.event)}
            )
        ]);
        const log = events(event, rs);
        const created = log.create(new Date(), {}, ['test']);
        assert(history.all()[0].event === created, 'alert does not reference event');
    });

    it('acknowledges alert and preserves event reference', function() {
        const history = alerts(alert, acknowledgedAlert);
        const rs = rules([
            rule(
                (ctx) => {return ctx.event !== undefined},
                (ctx) => {history.trigger('Test', new Date(), 'obj', ctx.event)}
            )
        ]);
        const log = events(event, rs);
        const created = log.create(new Date(), {}, []);
        history.all()[0].acknowledge();
        assert(history.all()[0].event === created, 'event reference not preserved after acknowledge');
    });

    it('tracks melting lifecycle with machine weight', function() {
        const sensors = {
            voltage: { name: () => {return 'voltage'}, current: () => {return {value: 380, unit: 'V'}} },
            cosphi: { name: () => {return 'cosphi'}, current: () => {return {value: 0.95, unit: ''}} }
        };
        const history = alerts(alert, acknowledgedAlert);
        const machine = meltingMachine(`m-${Math.random()}`, sensors, history);
        const sessions = meltings();
        machine.load(100);
        const active = sessions.add(machine);
        machine.dispense(30);
        const completed = active.stop();
        const chron = completed.chronology().get();
        assert(chron.end !== undefined, 'melting not completed');
    });

    it('filters alerts by machine through meltingMachine', function() {
        const sensors = {
            voltage: { name: () => {return 'voltage'}, current: () => {return {value: 380, unit: 'V'}} },
            cosphi: { name: () => {return 'cosphi'}, current: () => {return {value: 0.95, unit: ''}} }
        };
        const history = alerts(alert, acknowledgedAlert);
        const name = `m-${Math.random()}`;
        const machine = meltingMachine(name, sensors, history);
        history.trigger(`Alert for ${name}`, new Date(), name);
        history.trigger('Alert for other', new Date(), 'other');
        assert(machine.alerts().length === 1, 'machine alerts not filtered correctly');
    });

    it('evaluates multiple rules on single event', function() {
        let count = 0;
        const rs = rules([
            rule(() => {return true}, () => { count += 1; }),
            rule(() => {return true}, () => { count += 1; }),
            rule(() => {return true}, () => { count += 1; })
        ]);
        const log = events(event, rs);
        log.create(new Date(), {}, []);
        assert(count === 3, 'not all rules were evaluated');
    });

    it('passes event to rule context for conditional evaluation', function() {
        const history = alerts(alert, acknowledgedAlert);
        const label = `label-${Math.random()}`;
        const rs = rules([
            rule(
                (ctx) => {return ctx.event.labels().includes(label)},
                () => {history.trigger('Matched', new Date(), 'obj')}
            ),
            rule(
                (ctx) => {return ctx.event.labels().includes('other')},
                () => {history.trigger('Not matched', new Date(), 'obj')}
            )
        ]);
        const log = events(event, rs);
        log.create(new Date(), {}, [label]);
        assert(history.all().length === 1, 'wrong number of alerts triggered');
    });
});
