import assert from 'assert';
import alerts from '../src/alerts.js';

function fakeAlert(message, timestamp, object, acknowledge) {
    return {
        message,
        timestamp,
        object,
        acknowledge,
        acknowledged: false
    };
}

function fakeAcknowledgedAlert(message, timestamp, object) {
    return {
        message,
        timestamp,
        object,
        acknowledged: true
    };
}

describe('alerts', function() {
    it('returns alert when trigger is called', function() {
        const history = alerts(fakeAlert, fakeAcknowledgedAlert);
        const message = `msg${  Math.random()}`;
        assert(history.trigger(message, new Date(), 'obj') !== undefined);
    });

    it('returns alert with correct message', function() {
        const history = alerts(fakeAlert, fakeAcknowledgedAlert);
        const message = `msg${  Math.random()}`;
        assert(history.trigger(message, new Date(), 'obj').message === message);
    });

    it('returns alert with correct timestamp', function() {
        const history = alerts(fakeAlert, fakeAcknowledgedAlert);
        const timestamp = new Date();
        assert(history.trigger('msg', timestamp, 'obj').timestamp === timestamp);
    });

    it('returns alert with correct object property', function() {
        const history = alerts(fakeAlert, fakeAcknowledgedAlert);
        const object = `obj${  Math.random()}`;
        assert(history.trigger('msg', new Date(), object).object === object);
    });

    it('returns alert with acknowledged false', function() {
        const history = alerts(fakeAlert, fakeAcknowledgedAlert);
        assert(history.trigger('msg', new Date(), 'obj').acknowledged === false);
    });

    it('returns alert with acknowledge function', function() {
        const history = alerts(fakeAlert, fakeAcknowledgedAlert);
        assert(typeof history.trigger('msg', new Date(), 'obj').acknowledge === 'function');
    });

    it('returns empty array from all when no alerts exist', function() {
        const history = alerts(fakeAlert, fakeAcknowledgedAlert);
        assert(history.all().length === 0);
    });

    it('returns alert from all after trigger is called', function() {
        const history = alerts(fakeAlert, fakeAcknowledgedAlert);
        history.trigger('msg', new Date(), 'obj');
        assert(history.all().length === 1);
    });

    it('returns multiple alerts from all after multiple triggers', function() {
        const history = alerts(fakeAlert, fakeAcknowledgedAlert);
        history.trigger('msg1', new Date(), 'obj1');
        history.trigger('msg2', new Date(), 'obj2');
        history.trigger('msg3', new Date(), 'obj3');
        assert(history.all().length === 3);
    });

    it('returns empty array from all when filter rejects all', function() {
        const history = alerts(fakeAlert, fakeAcknowledgedAlert);
        history.trigger('msg', new Date(), 'obj');
        const rejectAll = function() { return false; };
        assert(history.all(rejectAll).length === 0);
    });

    it('returns matching alerts from all when filter accepts some', function() {
        const history = alerts(fakeAlert, fakeAcknowledgedAlert);
        history.trigger('keep', new Date(), 'obj1');
        history.trigger('reject', new Date(), 'obj2');
        history.trigger('keep', new Date(), 'obj3');
        const filter = function(a) { return a.message === 'keep'; };
        assert(history.all(filter).length === 2);
    });

    it('applies multiple filters with AND logic', function() {
        const history = alerts(fakeAlert, fakeAcknowledgedAlert);
        history.trigger('keep', new Date(), 'match');
        history.trigger('keep', new Date(), 'nomatch');
        history.trigger('reject', new Date(), 'match');
        const msgFilter = function(a) { return a.message === 'keep'; };
        const objFilter = function(a) { return a.object === 'match'; };
        assert(history.all(msgFilter, objFilter).length === 1);
    });

    it('replaces alert with acknowledged version after acknowledge', function() {
        const history = alerts(fakeAlert, fakeAcknowledgedAlert);
        const added = history.trigger('msg', new Date(), 'obj');
        added.acknowledge();
        assert(history.all()[0].acknowledged === true);
    });

    it('returns acknowledged alert with acknowledged true', function() {
        const history = alerts(fakeAlert, fakeAcknowledgedAlert);
        history.trigger('msg', new Date(), 'obj').acknowledge();
        assert(history.all()[0].acknowledged === true);
    });

    it('preserves message after acknowledge', function() {
        const history = alerts(fakeAlert, fakeAcknowledgedAlert);
        const message = `msg${  Math.random()}`;
        history.trigger(message, new Date(), 'obj').acknowledge();
        assert(history.all()[0].message === message);
    });

    it('preserves timestamp after acknowledge', function() {
        const history = alerts(fakeAlert, fakeAcknowledgedAlert);
        const timestamp = new Date();
        history.trigger('msg', timestamp, 'obj').acknowledge();
        assert(history.all()[0].timestamp === timestamp);
    });

    it('preserves object property after acknowledge', function() {
        const history = alerts(fakeAlert, fakeAcknowledgedAlert);
        const object = `obj${  Math.random()}`;
        history.trigger('msg', new Date(), object).acknowledge();
        assert(history.all()[0].object === object);
    });
});
