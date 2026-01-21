import assert from 'assert';
import rules from '../src/rules.js';
import rule from '../src/rule.js';

describe('rules', function() {
    it('evaluates all rules in collection', function() {
        let count = 0;
        const r1 = rule(() => {return true}, () => { count += 1; });
        const r2 = rule(() => {return true}, () => { count += 1; });
        const rs = rules([r1, r2]);
        rs.evaluate({});
        assert(count === 2, 'not all rules were evaluated');
    });

    it('passes context to each rule', function() {
        const value = Math.random();
        let received = null;
        const r = rule((ctx) => { received = ctx; return false; }, () => {});
        const rs = rules([r]);
        rs.evaluate({ value });
        assert(received !== null && received.value === value, 'context was not passed');
    });

    it('evaluates empty collection without error', function() {
        const rs = rules([]);
        rs.evaluate({});
        assert(true, 'empty rules should not throw');
    });

    it('returns all rules from all method', function() {
        const r1 = rule(() => {return true}, () => {});
        const r2 = rule(() => {return false}, () => {});
        const rs = rules([r1, r2]);
        assert(rs.all().length === 2, 'all should return all rules');
    });

    it('returns copy of rules array', function() {
        const r1 = rule(() => {return true}, () => {});
        const rs = rules([r1]);
        const returned = rs.all();
        returned.push(r1);
        assert(rs.all().length === 1, 'rules array was mutated');
    });

    it('evaluates matching rules only', function() {
        let matched = 0;
        let unmatched = 0;
        const r1 = rule(() => {return true}, () => { matched += 1; });
        const r2 = rule(() => {return false}, () => { unmatched += 1; });
        const rs = rules([r1, r2]);
        rs.evaluate({});
        assert(matched === 1 && unmatched === 0, 'only matching rules should execute');
    });

    it('evaluates rules with sensor context', function() {
        let triggered = false;
        const threshold = 350 + Math.random() * 50;
        const r = rule(
            (ctx) => {return ctx.sensor && ctx.sensor.voltage < threshold},
            () => { triggered = true; }
        );
        const rs = rules([r]);
        rs.evaluate({ sensor: { voltage: threshold - 1 } });
        assert(triggered, 'sensor rule was not triggered');
    });

    it('evaluates rules with event context', function() {
        let triggered = false;
        const label = `label-${Math.random()}`;
        const r = rule(
            (ctx) => {return ctx.event && ctx.event.labels().includes(label)},
            () => { triggered = true; }
        );
        const fakeEvent = { labels: () => {return [label]} };
        const rs = rules([r]);
        rs.evaluate({ event: fakeEvent });
        assert(triggered, 'event rule was not triggered');
    });

    it('evaluates rules in order', function() {
        const order = [];
        const r1 = rule(() => {return true}, () => { order.push(1); });
        const r2 = rule(() => {return true}, () => { order.push(2); });
        const r3 = rule(() => {return true}, () => { order.push(3); });
        const rs = rules([r1, r2, r3]);
        rs.evaluate({});
        assert(order[0] === 1 && order[1] === 2 && order[2] === 3, 'rules evaluated out of order');
    });
});
