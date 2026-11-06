import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import stompit from 'stompit';
import stompSource from '../../../src/infrastructure/streams/stompSource.js';
import follow from '../../../src/infrastructure/streams/follow.js';

function harness() {
    const originals = { Channel: stompit.Channel, ConnectFailover: stompit.ConnectFailover };
    const fake = { closes: 0, acks: 0, nacks: 0 };
    stompit.ConnectFailover = function ConnectFailover() { fake.failover = new EventEmitter(); return fake.failover; };
    stompit.Channel = function Channel() { return {
        subscribe(_headers, callback) { fake.receive = callback; }, close() { fake.closes += 1; },
        ack() { fake.acks += 1; }, nack() { fake.nacks += 1; }
    }; };
    fake.restore = () => { Object.assign(stompit, originals); };
    fake.message = (body = '{}') => {return { readString(_encoding, callback) { callback(null, body); } }};
    return fake;
}
describe('STOMP terminal failure visibility', () => {
    it('reports rejected parallel delivery without serializing later arrivals', async () => {
        const errors = []; const failure = new Error('write rejected');
        await follow(Promise.resolve(), async () => {return 'record'}, async () => { throw failure; }, false, error => { errors.push(error); });
        await delay(0);
        assert.deepEqual(errors, [failure]);
    });
    it('fences once, reports fatal timeout and never ACKs a late write', async () => {
        const fake = harness(); const failures = []; let release;
        const source = stompSource('stomp://test', '/queue/test', { accept() { return new Promise(resolve => { release = resolve; }); } },
            { serial: false, acceptTimeoutMs: 20, onFatal(error) { failures.push(error); }, onError() {} });
        try {
            source.start(); fake.failover.emit('connect'); fake.receive(null, fake.message());
            await delay(60);
            assert.equal(failures.length, 1);
            assert.match(failures[0].message, /STOMP acceptance.*timed out/u);
            assert.equal(fake.closes, 1);
            assert.equal(source.health().state, 'failed');
            assert.throws(() => {return source.start()}, /timed out/u);
            fake.failover.emit('connect');
            assert.equal(source.health().state, 'failed', 'late connect revived a fenced delivery');
            release(); await delay(0);
            assert.equal(fake.acks, 0);
            await assert.rejects(source.stop(), /timed out/u);
        } finally { release?.(); fake.restore(); }
    });
    it('reflects connection loss/recovery and makes subscription failure terminal', async () => {
        const fake = harness(); const failures = [];
        const source = stompSource('stomp://test', '/queue/test', { accept() {} }, { onFatal(error) { failures.push(error); }, onError() {} });
        try {
            source.start(); assert.equal(source.health().state, 'starting');
            fake.failover.emit('connect'); assert.equal(source.health().state, 'running');
            fake.failover.emit('connecting'); assert.equal(source.health().state, 'degraded');
            fake.failover.emit('connect'); assert.equal(source.health().state, 'running');
            const failure = new Error('subscription rejected'); fake.receive(failure);
            assert.deepEqual(failures, [failure]); assert.equal(source.health().state, 'failed');
            await assert.rejects(source.stop(), /subscription rejected/u);
        } finally { fake.restore(); }
    });
    it('keeps body reads bounded even when a collector has a longer delivery queue budget', async () => {
        const fake = harness(); const failures = [];
        const source = stompSource('stomp://test', '/queue/test', { accept() {} },
            { acceptTimeoutMs: 20, deliveryTimeoutMs: 1000, onFatal(error) { failures.push(error); }, onError() {} });
        try {
            source.start();fake.receive(null, { readString() {} });
            await delay(60);
            assert.equal(failures.length, 1);
            assert.match(failures[0].message, /STOMP read.*timed out/u);
            assert.equal(fake.closes, 1);
            await assert.rejects(source.stop(), /STOMP read/u);
        } finally { fake.restore(); }
    });
    it('rejects an invalid delivery queue budget', () => {
        assert.throws(() => { stompSource('stomp://test', '/queue/test', { accept() {} }, { deliveryTimeoutMs: 0 }); }, /deliveryTimeoutMs/u);
    });

    it('requeues a manual-ack frame rejected before the collector can settle it', async () => {
        const fake = harness();
        const source = stompSource('stomp://test', '/queue/test', { accept() { throw new Error('admission rejected'); } },
            { manualAck: true, serial: false, onError() {} });
        try {
            source.start();fake.receive(null, fake.message());await delay(10);
            assert.equal(fake.nacks, 1);assert.equal(fake.acks, 0);
            await source.stop();
        } finally { fake.restore(); }
    });

});
