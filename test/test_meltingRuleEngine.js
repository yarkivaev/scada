import assert from 'assert';
import meltingRuleEngine from '../src/meltingRuleEngine.js';

describe('meltingRuleEngine', function() {
    it('issues critical low voltage alert when voltage below 350', function() {
        let issued = null;
        const engine = meltingRuleEngine(function(msg) { issued = msg; });
        engine.evaluate({ voltage: { value: 340 }, cosphi: { value: 0.9 } });
        assert(issued.includes('Critical low voltage'));
    });

    it('issues low voltage alert when voltage between 350 and 360', function() {
        let issued = null;
        const engine = meltingRuleEngine(function(msg) { issued = msg; });
        engine.evaluate({ voltage: { value: 355 }, cosphi: { value: 0.9 } });
        assert(issued.includes('Low voltage'));
    });

    it('issues critical high voltage alert when voltage above 410', function() {
        let issued = null;
        const engine = meltingRuleEngine(function(msg) { issued = msg; });
        engine.evaluate({ voltage: { value: 420 }, cosphi: { value: 0.9 } });
        assert(issued.includes('Critical high voltage'));
    });

    it('issues high voltage alert when voltage between 400 and 410', function() {
        let issued = null;
        const engine = meltingRuleEngine(function(msg) { issued = msg; });
        engine.evaluate({ voltage: { value: 405 }, cosphi: { value: 0.9 } });
        assert(issued.includes('High voltage'));
    });

    it('does not issue voltage alert when voltage is normal', function() {
        let issued = null;
        const engine = meltingRuleEngine(function(msg) { issued = msg; });
        engine.evaluate({ voltage: { value: 380 }, cosphi: { value: 0.9 } });
        assert(issued === null);
    });

    it('issues critical low power factor alert when cosphi below 0.7', function() {
        let issued = null;
        const engine = meltingRuleEngine(function(msg) { issued = msg; });
        engine.evaluate({ voltage: { value: 380 }, cosphi: { value: 0.6 } });
        assert(issued.includes('Critical low power factor'));
    });

    it('issues low power factor alert when cosphi between 0.7 and 0.8', function() {
        let issued = null;
        const engine = meltingRuleEngine(function(msg) { issued = msg; });
        engine.evaluate({ voltage: { value: 380 }, cosphi: { value: 0.75 } });
        assert(issued.includes('Low power factor'));
    });

    it('does not issue cosphi alert when cosphi is normal', function() {
        let issued = null;
        const engine = meltingRuleEngine(function(msg) { issued = msg; });
        engine.evaluate({ voltage: { value: 380 }, cosphi: { value: 0.85 } });
        assert(issued === null);
    });

    it('issues power quality alert when voltage low and cosphi low', function() {
        const alerts = [];
        const engine = meltingRuleEngine(function(msg) { alerts.push(msg); });
        engine.evaluate({ voltage: { value: 365 }, cosphi: { value: 0.75 } });
        assert(alerts.some(function(msg) { return msg.includes('Power quality'); }));
    });

    it('does not issue power quality alert when voltage normal', function() {
        const alerts = [];
        const engine = meltingRuleEngine(function(msg) { alerts.push(msg); });
        engine.evaluate({ voltage: { value: 380 }, cosphi: { value: 0.75 } });
        assert(!alerts.some(function(msg) { return msg.includes('Power quality'); }));
    });

    it('does not issue power quality alert when cosphi normal', function() {
        const alerts = [];
        const engine = meltingRuleEngine(function(msg) { alerts.push(msg); });
        engine.evaluate({ voltage: { value: 365 }, cosphi: { value: 0.85 } });
        assert(!alerts.some(function(msg) { return msg.includes('Power quality'); }));
    });

    it('passes timestamp to issue callback', function() {
        let received = null;
        const engine = meltingRuleEngine(function(msg, ts) { received = ts; });
        engine.evaluate({ voltage: { value: 340 }, cosphi: { value: 0.9 } });
        assert(received instanceof Date);
    });

    it('handles missing voltage gracefully', function() {
        let issued = null;
        const engine = meltingRuleEngine(function(msg) { issued = msg; });
        engine.evaluate({ cosphi: { value: 0.9 } });
        assert(issued === null);
    });

    it('handles missing cosphi gracefully', function() {
        let issued = null;
        const engine = meltingRuleEngine(function(msg) { issued = msg; });
        engine.evaluate({ voltage: { value: 380 } });
        assert(issued === null);
    });

    it('handles empty snapshot gracefully', function() {
        let issued = null;
        const engine = meltingRuleEngine(function(msg) { issued = msg; });
        engine.evaluate({});
        assert(issued === null);
    });

    it('includes voltage value in alert message', function() {
        let issued = null;
        const engine = meltingRuleEngine(function(msg) { issued = msg; });
        engine.evaluate({ voltage: { value: 340.5 }, cosphi: { value: 0.9 } });
        assert(issued.includes('340.5'));
    });

    it('includes cosphi value in alert message', function() {
        let issued = null;
        const engine = meltingRuleEngine(function(msg) { issued = msg; });
        engine.evaluate({ voltage: { value: 380 }, cosphi: { value: 0.65 } });
        assert(issued.includes('0.65'));
    });
});
