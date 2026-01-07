import assert from 'assert';
import { acknowledgedAlert, alert } from '../src/alert.js';

describe('alert', function() {
    it('returns alert with correct id', function() {
        const id = `id${Math.random()}`;
        const created = alert(id, 'msg', new Date(), 'obj', function() {});
        assert(created.id === id);
    });

    it('returns alert with correct message', function() {
        const message = `msg${Math.random()}`;
        const created = alert('id', message, new Date(), 'obj', function() {});
        assert(created.message === message);
    });

    it('returns alert with correct timestamp', function() {
        const timestamp = new Date();
        const created = alert('id', 'msg', timestamp, 'obj', function() {});
        assert(created.timestamp === timestamp);
    });

    it('returns alert with correct object property', function() {
        const object = `obj${Math.random()}`;
        const created = alert('id', 'msg', new Date(), object, function() {});
        assert(created.object === object);
    });

    it('returns alert with acknowledge function', function() {
        const handler = function() {};
        const created = alert('id', 'msg', new Date(), 'obj', handler);
        assert(created.acknowledge === handler);
    });

    it('returns alert with acknowledged false', function() {
        const created = alert('id', 'msg', new Date(), 'obj', function() {});
        assert(created.acknowledged === false);
    });
});

describe('acknowledgedAlert', function() {
    it('returns alert with correct id', function() {
        const id = `id${Math.random()}`;
        const created = acknowledgedAlert(id, 'msg', new Date(), 'obj');
        assert(created.id === id);
    });

    it('returns alert with correct message', function() {
        const message = `msg${Math.random()}`;
        const created = acknowledgedAlert('id', message, new Date(), 'obj');
        assert(created.message === message);
    });

    it('returns alert with correct timestamp', function() {
        const timestamp = new Date();
        const created = acknowledgedAlert('id', 'msg', timestamp, 'obj');
        assert(created.timestamp === timestamp);
    });

    it('returns alert with correct object property', function() {
        const object = `obj${Math.random()}`;
        const created = acknowledgedAlert('id', 'msg', new Date(), object);
        assert(created.object === object);
    });

    it('returns alert with acknowledged true', function() {
        const created = acknowledgedAlert('id', 'msg', new Date(), 'obj');
        assert(created.acknowledged === true);
    });
});
