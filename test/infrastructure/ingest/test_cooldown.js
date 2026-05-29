import assert from 'assert';
import cooldown from '../../../src/infrastructure/ingest/cooldown.js';

describe('cooldown', function() {
    it('calls issue callback on first invocation', function() {
        const message = `сообщение${Math.random()}`;
        let received = null;
        const limited = cooldown(function(msg) { received = msg; }, 60000);
        limited(message, new Date());
        assert(received === message, 'issue callback was not called on first invocation');
    });

    it('passes timestamp to issue callback', function() {
        const timestamp = new Date(Date.now() + Math.floor(Math.random() * 10000));
        let received = null;
        const limited = cooldown(function(msg, ts) { received = ts; }, 60000);
        limited('test', timestamp);
        assert(received === timestamp, 'timestamp was not passed to issue callback');
    });

    it('blocks duplicate message within cooldown interval', function() {
        const message = `тест${Math.random()}`;
        let count = 0;
        const limited = cooldown(function() { count += 1; }, 60000);
        const now = new Date();
        limited(message, now);
        limited(message, new Date(now.getTime() + 1000));
        assert(count === 1, 'duplicate message was not blocked within cooldown interval');
    });

    it('allows same message after cooldown interval expires', function() {
        const interval = 1000 + Math.floor(Math.random() * 1000);
        const message = `повтор${Math.random()}`;
        let count = 0;
        const limited = cooldown(function() { count += 1; }, interval);
        const now = new Date();
        limited(message, now);
        limited(message, new Date(now.getTime() + interval));
        assert(count === 2, 'message was blocked after cooldown interval expired');
    });

    it('tracks cooldown per message independently', function() {
        const first = `первое${Math.random()}`;
        const second = `второе${Math.random()}`;
        const received = [];
        const limited = cooldown(function(msg) { received.push(msg); }, 60000);
        const now = new Date();
        limited(first, now);
        limited(second, now);
        assert(received.length === 2, 'different messages were not tracked independently');
    });

    it('blocks only the specific message that is in cooldown', function() {
        const blocked = `блок${Math.random()}`;
        const allowed = `разрешен${Math.random()}`;
        const received = [];
        const limited = cooldown(function(msg) { received.push(msg); }, 60000);
        const now = new Date();
        limited(blocked, now);
        limited(blocked, new Date(now.getTime() + 100));
        limited(allowed, new Date(now.getTime() + 200));
        assert(received.includes(allowed), 'unrelated message was incorrectly blocked');
    });

    it('allows message exactly at cooldown boundary', function() {
        const interval = 500 + Math.floor(Math.random() * 500);
        const message = `граница${Math.random()}`;
        let count = 0;
        const limited = cooldown(function() { count += 1; }, interval);
        const now = new Date();
        limited(message, now);
        limited(message, new Date(now.getTime() + interval));
        assert(count === 2, 'message was blocked at exact cooldown boundary');
    });

    it('handles cyrillic messages correctly', function() {
        const message = `Включить переключатель компенсации ${Math.random()}`;
        let received = null;
        const limited = cooldown(function(msg) { received = msg; }, 60000);
        limited(message, new Date());
        assert(received === message, 'cyrillic message was not handled correctly');
    });

    it('resets cooldown after interval passes', function() {
        const interval = 100;
        const message = `сброс${Math.random()}`;
        const received = [];
        const limited = cooldown(function(msg) { received.push(msg); }, interval);
        const base = new Date();
        limited(message, base);
        limited(message, new Date(base.getTime() + interval));
        limited(message, new Date(base.getTime() + interval * 2));
        assert(received.length === 3, 'cooldown did not reset properly after interval');
    });
});
