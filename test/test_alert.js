import assert from 'assert';
import { acknowledgedAlert, alert } from '../src/alert.js';

describe('alert', function() {
    it('returns alert with correct id', function() {
        const id = `id${Math.random()}`;
        const created = alert(id, 'msg', new Date(), 'obj', undefined, function() {});
        assert(created.id === id, 'id mismatch');
    });

    it('returns alert with correct message', function() {
        const message = `msg${Math.random()}`;
        const created = alert('id', message, new Date(), 'obj', undefined, function() {});
        assert(created.message === message, 'message mismatch');
    });

    it('returns alert with correct timestamp', function() {
        const timestamp = new Date();
        const created = alert('id', 'msg', timestamp, 'obj', undefined, function() {});
        assert(created.timestamp === timestamp, 'timestamp mismatch');
    });

    it('returns alert with correct object property', function() {
        const object = `obj${Math.random()}`;
        const created = alert('id', 'msg', new Date(), object, undefined, function() {});
        assert(created.object === object, 'object mismatch');
    });

    it('returns alert with acknowledge function', function() {
        const handler = function() {};
        const created = alert('id', 'msg', new Date(), 'obj', undefined, handler);
        assert(created.acknowledge === handler, 'acknowledge function mismatch');
    });

    it('returns alert with acknowledged false', function() {
        const created = alert('id', 'msg', new Date(), 'obj', undefined, function() {});
        assert(created.acknowledged === false, 'acknowledged should be false');
    });

    it('returns alert with source event reference', function() {
        const source = { id: () => {return `ev-${Math.random()}`} };
        const created = alert('id', 'msg', new Date(), 'obj', source, function() {});
        assert(created.event === source, 'event reference mismatch');
    });

    it('returns alert with undefined event when no source provided', function() {
        const created = alert('id', 'msg', new Date(), 'obj', undefined, function() {});
        assert(created.event === undefined, 'event should be undefined');
    });
});

describe('acknowledgedAlert', function() {
    it('returns alert with correct id', function() {
        const id = `id${Math.random()}`;
        const created = acknowledgedAlert(id, 'msg', new Date(), 'obj', undefined);
        assert(created.id === id, 'id mismatch');
    });

    it('returns alert with correct message', function() {
        const message = `msg${Math.random()}`;
        const created = acknowledgedAlert('id', message, new Date(), 'obj', undefined);
        assert(created.message === message, 'message mismatch');
    });

    it('returns alert with correct timestamp', function() {
        const timestamp = new Date();
        const created = acknowledgedAlert('id', 'msg', timestamp, 'obj', undefined);
        assert(created.timestamp === timestamp, 'timestamp mismatch');
    });

    it('returns alert with correct object property', function() {
        const object = `obj${Math.random()}`;
        const created = acknowledgedAlert('id', 'msg', new Date(), object, undefined);
        assert(created.object === object, 'object mismatch');
    });

    it('returns alert with acknowledged true', function() {
        const created = acknowledgedAlert('id', 'msg', new Date(), 'obj', undefined);
        assert(created.acknowledged === true, 'acknowledged should be true');
    });

    it('returns alert with source event reference', function() {
        const source = { id: () => {return `ev-${Math.random()}`} };
        const created = acknowledgedAlert('id', 'msg', new Date(), 'obj', source);
        assert(created.event === source, 'event reference mismatch');
    });

    it('returns alert with undefined event when no source provided', function() {
        const created = acknowledgedAlert('id', 'msg', new Date(), 'obj', undefined);
        assert(created.event === undefined, 'event should be undefined');
    });
});
