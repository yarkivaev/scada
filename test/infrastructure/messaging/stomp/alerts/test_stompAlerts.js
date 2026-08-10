import assert from 'assert';
import stompAlerts from '../../../../../src/infrastructure/messaging/stomp/alerts/stompAlerts.js';

function fakeHydrate(initial) {
    const rows = initial ? [...initial] : [];
    return {
        async listUnacknowledged() {
            return rows.filter((row) => {
                return !row.acknowledged;
            });
        }
    };
}

function fakeStomp() {
    const ref = { collector: null };
    return {
        ref,
        factory(collector) {
            ref.collector = collector;
            return {
                start() {},
                stop() {}
            };
        }
    };
}

describe('stompAlerts', function() {
    it('returns empty array when no alerts exist', async function() {
        const hydrate = fakeHydrate([]);
        const stomp = fakeStomp();
        const history = stompAlerts(hydrate, stomp.factory, { [`rule_${Math.random()}`]: 'test' });
        await history.init();
        assert.strictEqual(history.all().length, 0, 'alerts were not empty');
    });

    it('loads unacknowledged alerts from hydration port on init', async function() {
        const id = Math.floor(Math.random() * 10000) + 1;
        const message = `message_${Math.random()}`;
        const machine = `m${Math.random()}`;
        const name = `rule_${Math.random()}`;
        const hydrate = fakeHydrate([{ id, message, machine, timestamp: new Date(), acknowledged: false, name }]);
        const stomp = fakeStomp();
        const history = stompAlerts(hydrate, stomp.factory, {});
        await history.init();
        assert.strictEqual(history.all().length, 1, 'alert was not loaded from hydration port');
    });

    it('creates alert on pending STOMP message and emits created event', async function() {
        const hydrate = fakeHydrate([]);
        const stomp = fakeStomp();
        const name = `low_cosphi_${Math.random()}`;
        const translations = { [name]: `Disable_${Math.random()}` };
        const history = stompAlerts(hydrate, stomp.factory, translations);
        await history.init();
        const events = [];
        history.stream((evt) => {
            events.push(evt);
        });
        stomp.ref.collector.accept({
            payload: JSON.stringify({ name, machine: 'm2', severity: 'warning', status: 'pending', start: 1700000000 + Math.floor(Math.random() * 1000) })
        });
        assert.strictEqual(events[0].type, 'created', 'created event was not emitted');
    });

    it('acknowledges alert on completed STOMP message and emits acknowledged event', async function() {
        const machine = `m${Math.random()}`;
        const id = Math.floor(Math.random() * 10000) + 1;
        const name = `rule_${Math.random()}`;
        const hydrate = fakeHydrate([{ id, message: 'test', machine, timestamp: new Date(), acknowledged: false, name }]);
        const stomp = fakeStomp();
        const history = stompAlerts(hydrate, stomp.factory, {});
        await history.init();
        const events = [];
        history.stream((evt) => {
            events.push(evt);
        });
        stomp.ref.collector.accept({
            payload: JSON.stringify({ name, machine, severity: 'warning', status: 'completed', start: 1700000000 })
        });
        assert.strictEqual(events[0].type, 'acknowledged', 'acknowledged event was not emitted');
    });

    it('finds alert by string id', async function() {
        const id = Math.floor(Math.random() * 10000) + 1;
        const machine = `m${Math.random()}`;
        const name = `n_${Math.random()}`;
        const hydrate = fakeHydrate([{ id, message: 'test', machine, timestamp: new Date(), acknowledged: false, name }]);
        const stomp = fakeStomp();
        const history = stompAlerts(hydrate, stomp.factory, {});
        await history.init();
        assert.strictEqual(history.find(String(id)).object, machine, 'alert was not found by string id');
    });

    it('filters alerts via all with predicate', async function() {
        const id = Math.floor(Math.random() * 10000) + 1;
        const machine = `m${Math.random()}`;
        const name = `n_${Math.random()}`;
        const hydrate = fakeHydrate([{ id, message: 'test', machine, timestamp: new Date(), acknowledged: false, name }]);
        const stomp = fakeStomp();
        const history = stompAlerts(hydrate, stomp.factory, {});
        await history.init();
        const filtered = history.all((a) => {
            return a.object === machine;
        });
        assert.strictEqual(filtered.length, 1, 'alert was not filtered correctly');
    });

    it('falls back to rule name for unknown translations', async function() {
        const hydrate = fakeHydrate([]);
        const stomp = fakeStomp();
        const history = stompAlerts(hydrate, stomp.factory, {});
        await history.init();
        const name = `unknown_rule_${Math.random()}`;
        stomp.ref.collector.accept({
            payload: JSON.stringify({ name, machine: 'm2', severity: 'warning', status: 'pending', start: 1700000000 })
        });
        const all = history.all();
        assert.strictEqual(all[0].message, name, 'unknown rule was not used as fallback message');
    });
});
