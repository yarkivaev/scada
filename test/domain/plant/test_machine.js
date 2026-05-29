import assert from 'assert';
import { alert, acknowledgedAlert, alerts, machine, memoryTimelineFull, plant, shop, initialized } from '../../../index.js';

describe('machine', function() {
    it('exposes sensors timeline and filtered alerts', function() {
        const history = alerts(alert, acknowledgedAlert);
        const tl = memoryTimelineFull();
        const sensors = { voltage: { name() { return 'V'; } } };
        const item = machine(`m${Math.random()}`, { sensors, alerts: history, timeline: tl });
        assert.strictEqual(typeof item.name(), 'string');
        assert.strictEqual(item.sensors, sensors);
        assert.strictEqual(item.timeline, tl);
    });
});

describe('plant', function() {
    it('initializes shops', function() {
        const history = alerts(alert, acknowledgedAlert);
        const tl = memoryTimelineFull();
        const sensors = {};
        const unit = machine('x1', { sensors, alerts: history, timeline: tl });
        const area = shop('area', initialized({ x1: unit }, Object.values), history);
        const p = plant(initialized({ area }, Object.values));
        p.init();
        assert.strictEqual(p.shops.get().area.name(), 'area');
    });
});
