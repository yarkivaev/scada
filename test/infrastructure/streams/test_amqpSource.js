 
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import amqpSource from '../../../src/infrastructure/streams/amqpSource.js';

function broker() {
    const events = [];
    const channel = new EventEmitter();
    const connection = new EventEmitter();
    Object.assign(channel, {
        assertQueue: async () => { events.push('queue'); },
        prefetch: async () => {},
        consume: async (queue, callback) => { channel.deliver = callback; return { consumerTag: 'tag' }; },
        ack: () => { events.push('ack'); },
        nack: (msg, all, requeue) => { events.push(['reject', requeue]); },
        cancel: async () => { events.push('cancel'); },
        close: async () => { events.push('channel.close'); }
    });
    connection.createChannel = async () => { return channel; };
    connection.close = async () => { events.push('connection.close'); };
    return { connection, channel, events };
}
const message = { content: Buffer.from('value'), fields: {}, properties: {} };
describe('amqpSource', () => {
    it('acknowledges only after asynchronous acceptance', async () => {
        const fake = broker();
        let release;
        const source = amqpSource('amqp://test', 'queue', { accept: () => { return new Promise((resolve) => { release = resolve; }); } }, { connect: async () => { return fake.connection; } });
        await source.start();
        const pending = fake.channel.deliver(message);
        assert.deepEqual(fake.events, ['queue']);
        release();
        await pending;
        assert.deepEqual(fake.events, ['queue', 'ack']);
        await source.stop();
    });
    it('requeues acceptance failures and does not double settle explicit rejects', async () => {
        const fake = broker();
        const errors = [];
        const source = amqpSource('amqp://test', 'queue', { accept: async (delivery) => { delivery.reject(false); throw new Error('bad record'); } }, { connect: async () => { return fake.connection; }, onError: (error) => { errors.push(error.message); } });
        await source.start();
        await fake.channel.deliver(message);
        assert.deepEqual(fake.events, ['queue', ['reject', false]]);
        assert.deepEqual(errors, ['bad record']);
        await source.stop();
    });
    it('closes a partially subscribed session before retrying', async () => {
        const fake = broker();
        fake.channel.assertQueue = async () => { throw new Error('queue failure'); };
        const callbacks = [];
        const source = amqpSource('amqp://test', 'queue', { accept: () => {} }, { connect: async () => { return fake.connection; }, onError: () => {}, schedule: (callback) => { callbacks.push(callback); return 1; }, clear: () => {} });
        await source.start();
        assert.deepEqual(fake.events, ['channel.close', 'connection.close']);
        assert.equal(callbacks.length, 1);
        await source.stop();
    });
    it('closes a lost session once before scheduling one replacement', async () => {
        const fake = broker();
        const callbacks = [];
        const source = amqpSource('amqp://test', 'queue', { accept: () => {} }, { connect: async () => { return fake.connection; }, schedule: (callback) => { callbacks.push(callback); return 1; }, clear: () => {}, onError: () => {} });
        await source.start();
        fake.channel.emit('error', new Error('lost'));
        fake.connection.emit('close');
        await new Promise((resolve) => { setImmediate(resolve); });
        assert.deepEqual(fake.events, ['queue', 'cancel', 'channel.close', 'connection.close']);
        assert.equal(callbacks.length, 1);
        await source.stop();
    });
    it('requeues failed asynchronous acceptance', async () => {
        const fake = broker();
        const source = amqpSource('amqp://test', 'queue', { accept: async () => { throw new Error('unavailable'); } }, { connect: async () => { return fake.connection; }, onError: () => {} });
        await source.start();
        await fake.channel.deliver(message);
        assert.deepEqual(fake.events, ['queue', ['reject', true]]);
        await source.stop();
    });
    it('restart waits for the old connection to finish closing', async () => {
        const first = broker();
        const second = broker();
        let close;
        first.connection.close = () => { return new Promise((resolve) => { close = resolve; }); };
        let count = 0;
        const source = amqpSource('amqp://test', 'queue', { accept: () => {} }, { connect: async () => { count += 1; return count === 1 ? first.connection : second.connection; } });
        await source.start();
        const stopped = source.stop();
        const started = source.start();
        await new Promise((resolve) => { setImmediate(resolve); });
        assert.equal(count, 1);
        close();
        await stopped;
        await started;
        assert.equal(count, 2);
        await source.stop();
    });

    it('reports settlement failure without rejecting the broker callback', async () => {
        const fake = broker();
        const errors = [];
        fake.channel.ack = () => { throw new Error('channel closed'); };
        fake.channel.nack = () => { throw new Error('channel closed'); };
        const source = amqpSource('amqp://test', 'queue', { accept: () => {} }, {
            connect: () => { return Promise.resolve(fake.connection); },
            onError: (error) => { errors.push(error.message); }
        });
        await source.start();
        await assert.doesNotReject(fake.channel.deliver(message));
        assert.ok(errors.includes('channel closed'));
        await source.stop();
    });

    it('revokes settlement and drains acceptance before closing or restarting', async () => {
        const first = broker();
        const second = broker();
        let release;
        let connects = 0;
        const source = amqpSource('amqp://test', 'queue', {
            accept: () => { return new Promise((resolve) => { release = resolve; }); }
        }, { connect: () => { connects += 1; return Promise.resolve(connects === 1 ? first.connection : second.connection); } });
        await source.start();
        const delivery = first.channel.deliver(message);
        let stopped = false;
        const stopping = source.stop().then(() => { stopped = true; });
        const restarting = source.start();
        await new Promise((resolve) => { setImmediate(resolve); });
        const observed = { stopped, connects, events: [...first.events] };
        release();
        await Promise.all([delivery, stopping, restarting]);
        await source.stop();
        assert.deepEqual(observed, { stopped: false, connects: 1, events: ['queue', 'cancel'] });
        assert.deepEqual(first.events, ['queue', 'cancel', 'channel.close', 'connection.close']);
    });
    it('drains acceptance on connection loss before scheduling recovery', async () => {
        const fake = broker();
        let release;
        const retries = [];
        const source = amqpSource('amqp://test', 'queue', {
            accept: () => { return new Promise((resolve) => { release = resolve; }); }
        }, { connect: () => { return Promise.resolve(fake.connection); },
            schedule: (callback) => { retries.push(callback); return 1; }, clear: () => {} });
        await source.start();
        const delivery = fake.channel.deliver(message);
        fake.connection.emit('close');
        await new Promise((resolve) => { setImmediate(resolve); });
        const observed = { retries: retries.length, events: [...fake.events] };
        release();
        await delivery;
        await new Promise((resolve) => { setImmediate(resolve); });
        await source.stop();
        assert.deepEqual(observed, { retries: 0, events: ['queue', 'cancel'] });
        assert.equal(retries.length, 1);
    });

});

it('restores a consumer after a timed out reconnect settles', async () => {
    const initial = broker();
    const recovered = broker();
    const callbacks = [];
    let reject;
    let count = 0;
    const source = amqpSource('amqp://test', 'queue', { accept: async () => {} }, {
        connectTimeoutMs: 15, onError: () => {}, schedule(callback) { callbacks.push(callback); return callback; }, clear() {},
        connect() {
            count += 1;
            if (count === 1) { return Promise.resolve(initial.connection); }
            if (count === 2) { return new Promise((resolve, failure) => { reject = failure; }); }
            return Promise.resolve(recovered.connection);
        }
    });
    await source.start();
    initial.connection.emit('close');
    await new Promise(resolve => { setImmediate(resolve); });
    await callbacks.shift()().catch(() => {});
    reject(new Error('connect ETIMEDOUT'));
    await new Promise(resolve => { setImmediate(resolve); });
    const retry = callbacks.shift();
    if (retry) { await retry(); }
    const subscribed = typeof recovered.channel.deliver === 'function';
    await source.stop().catch(() => {});
    assert.equal(subscribed, true, 'Consumer stayed disconnected after its failed attempt settled');
});

it('disposes a late connection before opening its replacement consumer', async () => {
    const initial = broker();
    const late = broker();
    const recovered = broker();
    const callbacks = [];
    let complete;
    let count = 0;
    const source = amqpSource('amqp://test', 'queue', { accept: async () => {} }, {
        connectTimeoutMs: 15, onError: () => {}, schedule(callback) { callbacks.push(callback); return callback; }, clear() {},
        connect() {
            count += 1;
            if (count === 1) { return Promise.resolve(initial.connection); }
            if (count === 2) { return new Promise(resolve => { complete = resolve; }); }
            return Promise.resolve(recovered.connection);
        }
    });
    await source.start();
    initial.connection.emit('close');
    await new Promise(resolve => { setImmediate(resolve); });
    await callbacks.shift()().catch(() => {});
    complete(late.connection);
    await new Promise(resolve => { setImmediate(resolve); });
    const retry = callbacks.shift();
    if (retry) { await retry(); }
    const result = { closed: late.events.includes('connection.close'), subscribed: typeof recovered.channel.deliver === 'function' };
    await source.stop();
    assert.deepEqual(result, { closed: true, subscribed: true }, 'Late connection survived or replacement consumer was not subscribed');
});
