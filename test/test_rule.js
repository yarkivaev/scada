import assert from 'assert';
import rule from '../src/rule.js';

describe('rule', function() {
    it('executes action when trigger returns true', function() {
        let executed = false;
        const r = rule(() => {return true}, () => { executed = true; });
        r.evaluate({});
        assert(executed, 'action was not executed');
    });

    it('does not execute action when trigger returns false', function() {
        let executed = false;
        const r = rule(() => {return false}, () => { executed = true; });
        r.evaluate({});
        assert(!executed, 'action was executed when it should not');
    });

    it('passes context to trigger', function() {
        const value = Math.random();
        let received = null;
        const r = rule((ctx) => { received = ctx; return false; }, () => {});
        r.evaluate({ value });
        assert(received !== null && received.value === value, 'context was not passed to trigger');
    });

    it('passes context to action', function() {
        const value = Math.random();
        let received = null;
        const r = rule(() => {return true}, (ctx) => { received = ctx; });
        r.evaluate({ value });
        assert(received !== null && received.value === value, 'context was not passed to action');
    });

    it('evaluates sensor context correctly', function() {
        let triggered = false;
        const threshold = 350 + Math.random() * 50;
        const r = rule(
            (ctx) => {return ctx.sensor && ctx.sensor.voltage < threshold},
            () => { triggered = true; }
        );
        r.evaluate({ sensor: { voltage: threshold - 1 } });
        assert(triggered, 'sensor rule was not triggered');
    });

    it('evaluates event labels correctly', function() {
        let triggered = false;
        const label = `label-${Math.random()}`;
        const r = rule(
            (ctx) => {return ctx.event && ctx.event.labels().includes(label)},
            () => { triggered = true; }
        );
        const fakeEvent = { labels: () => {return [label]} };
        r.evaluate({ event: fakeEvent });
        assert(triggered, 'event rule was not triggered');
    });

    it('does not trigger when event lacks required label', function() {
        let triggered = false;
        const r = rule(
            (ctx) => {return ctx.event && ctx.event.labels().includes('required')},
            () => { triggered = true; }
        );
        const fakeEvent = { labels: () => {return ['other']} };
        r.evaluate({ event: fakeEvent });
        assert(!triggered, 'event rule was triggered incorrectly');
    });
});
