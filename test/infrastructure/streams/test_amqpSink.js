import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import amqpSink from '../../../src/infrastructure/streams/amqpSink.js';

function broker() {
  const sent = [];
  const confirmations = [];
  const channel = Object.assign(new EventEmitter(), {
    assertExchange(...args) { sent.push(['exchange', ...args]); return Promise.resolve(); },
    publish(exchange, routingKey, body, options, confirmed) {
      sent.push(['publish', exchange, routingKey, body.toString(), options]);
      confirmations.push(confirmed);
      return true;
    },
    close() { channel.emit('close'); return Promise.resolve(); }
  });
  const connection = Object.assign(new EventEmitter(), {
    createConfirmChannel() { return Promise.resolve(channel); },
    close() { connection.emit('close'); return Promise.resolve(); }
  });
  return { connection, channel, sent, confirmations };
}
const record = {exchange: 'events', routingKey: 'line.temperature', body: '{"value":42}',
  options: {persistent: true, contentType: 'application/json'}};

describe('amqpSink', function() {
  it('declares explicit exchanges and waits for broker confirmation', async function() {
    const fixture = broker();
    const sink = amqpSink('amqp://localhost', {connect: () => { return Promise.resolve(fixture.connection); },
      exchanges: [{name: 'events', type: 'topic', options: {durable: true}}]});
    await sink.start();
    let done = false;
    const written = sink.write([record]).then(() => { done = true; });
    await new Promise((resolve) => { setImmediate(resolve); });
    assert.equal(done, false);
    assert.deepEqual(fixture.sent, [['exchange', 'events', 'topic', {durable: true}],
      ['publish', 'events', 'line.temperature', record.body, record.options]]);
    fixture.confirmations[0](null);
    await written;
    assert.equal(done, true);
    await sink.stop();
  });
  it('rejects failed confirms without replaying an uncertain publication', async function() {
    const fixture = broker();
    const sink = amqpSink('amqp://localhost', {connect: () => { return Promise.resolve(fixture.connection); }});
    await sink.start();
    const written = sink.write([record]);
    fixture.confirmations[0](new Error('nack'));
    await assert.rejects(written, /nack/u);
    assert.equal(fixture.sent.length, 1);
    await sink.stop();
  });
  it('rejects offline writes and does not open duplicate sessions on repeated start', async function() {
    const fixture = broker();
    let connects = 0;
    const sink = amqpSink('amqp://localhost', {connect: () => { connects += 1; return Promise.resolve(fixture.connection); }});
    await assert.rejects(sink.write([record]), /not connected/u);
    await Promise.all([sink.start(), sink.start()]);
    assert.equal(connects, 1);
    assert.equal(sink.active(), true);
    await sink.stop();
    assert.equal(sink.active(), false);
  });
  it('closes a connection whose channel initialization failed', async function() {
    const fixture = broker();
    let closed = 0;
    fixture.connection.createConfirmChannel = () => { return Promise.reject(new Error('channel failed')); };
    fixture.connection.close = () => { closed += 1; return Promise.resolve(); };
    const sink = amqpSink('amqp://localhost', {connect: () => { return Promise.resolve(fixture.connection); }, retryMs: 10000});
    await assert.rejects(sink.start(), /channel failed/u);
    await sink.stop();
    assert.equal(closed, 1);
  });
  it('ignores a late connection after stop and supports a clean restart', async function() {
    let resolveConnection;
    const fixture = broker();
    const sink = amqpSink('amqp://localhost', {connect: () => { return new Promise((resolve) => { resolveConnection = resolve; }); }});
    const starting = sink.start();
    await new Promise((resolve) => { setImmediate(resolve); });
    const stopped = sink.stop();
    resolveConnection(fixture.connection);
    await Promise.all([starting, stopped]);
    assert.equal(sink.active(), false);
  });
  it('refuses more sends while transport is backpressured and resumes on drain', async function() {
    const fixture = broker();
    fixture.channel.publish = (...args) => { fixture.confirmations.push(args.at(-1)); return false; };
    const sink = amqpSink('amqp://localhost', {connect: () => { return Promise.resolve(fixture.connection); }});
    await sink.start();
    const first = sink.write([record]);
    await assert.rejects(sink.write([record]), /backpressure/u);
    fixture.confirmations[0](null);
    await first;
    fixture.channel.emit('drain');
    const second = sink.write([record]);
    fixture.confirmations[1](null);
    await second;
    await sink.stop();
  });
  it('retires a session after confirmation timeout without replaying its records', async function() {
    const fixture = broker();
    let closed = 0;
    fixture.connection.close = () => { closed += 1; return Promise.resolve(); };
    const sink = amqpSink('amqp://localhost', {connect: () => { return Promise.resolve(fixture.connection); },
      confirmTimeoutMs: 15, retryMs: 10000});
    await sink.start();
    await assert.rejects(sink.write([record]), /timed out/u);
    await new Promise((resolve) => { setImmediate(resolve); });
    assert.equal(sink.active(), false);
    assert.equal(closed, 1);
    assert.equal(fixture.sent.length, 1);
    await sink.stop();
  });
  it('bounds the number of outstanding confirmations', async function() {
    const fixture = broker();
    const sink = amqpSink('amqp://localhost', {connect: () => { return Promise.resolve(fixture.connection); }, maxPending: 1});
    await sink.start();
    const first = sink.write([record]);
    await assert.rejects(sink.write([record]), /backpressure/u);
    fixture.confirmations[0](null);
    await first;
    await sink.stop();
  });

});

it('mandatory AMQP publications reject correlated returns before confirms', async () => {
  const fake = broker();
  const sent = [];
  fake.channel.publish = (exchange, routingKey, body, options, confirm) => {
    sent.push({ options, confirm });
    return true;
  };
  const sink = amqpSink('amqp://test', { connect() { return Promise.resolve(fake.connection); } });
  await sink.start();
  const first = sink.write([{ ...record, options: { mandatory: true, messageId: 'event-one', headers: { eventId: 'event-one' } } }]);
  const rejected = assert.rejects(first, /unroutable|returned/iu);
  const second = sink.write([{ ...record, options: { mandatory: true, messageId: 'event-one' } }]);
  assert.equal(sent[0].options.messageId, 'event-one');
  assert.equal(sent[1].options.messageId, 'event-one');
  assert.equal(sent[0].options.headers.eventId, 'event-one');
  assert.notEqual(sent[0].options.headers['x-source-to-sink-publish-id'], sent[1].options.headers['x-source-to-sink-publish-id']);
  fake.channel.emit('return', { properties: { messageId: 'event-one', headers: sent[0].options.headers }, fields: { replyText: 'NO_ROUTE' } });
  sent[0].confirm();
  sent[1].confirm();
  await rejected;
  await second;
  await sink.stop();
});

it('recovers after a timed out connection settles during a broker outage', async () => {
  const initial = broker();
  const recovered = broker();
  let rejected;
  let count = 0;
  const sink = amqpSink('amqp://test', { connectTimeoutMs: 25, retryMs: 5, connect() {
    count += 1;
    if (count === 1) { return Promise.resolve(initial.connection); }
    if (count === 2) { return new Promise((resolve, reject) => { rejected = reject; }); }
    return Promise.resolve(recovered.connection);
  } });
  await sink.start();
  initial.connection.emit('close');
  await new Promise((resolve) => { setTimeout(resolve, 60); });
  rejected(new Error('connect ETIMEDOUT'));
  await new Promise((resolve) => { setTimeout(resolve, 35); });
  const active = sink.active();
  await sink.stop();
  assert.equal(active, true, 'Sink stayed disconnected after the failed attempt settled');
});

it('retires a late connection before reconnecting after its deadline', async () => {
  const initial = broker();
  const late = broker();
  const recovered = broker();
  let complete;
  let count = 0;
  let closed = false;
  late.connection.close = async () => { closed = true; };
  const sink = amqpSink('amqp://test', { connectTimeoutMs: 20, retryMs: 5, connect() {
    count += 1;
    if (count === 1) { return Promise.resolve(initial.connection); }
    if (count === 2) { return new Promise((resolve) => { complete = resolve; }); }
    return Promise.resolve(recovered.connection);
  } });
  await sink.start();
  initial.connection.emit('close');
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  complete(late.connection);
  await new Promise((resolve) => { setTimeout(resolve, 30); });
  const result = { closed, active: sink.active() };
  await sink.stop();
  assert.deepEqual(result, { closed: true, active: true }, 'Late connection survived or recovery failed');
});

it('cannot reuse a timed out sink when retiring its late connection fails', async () => {
  const initial = broker();
  const late = broker();
  const recovered = broker();
  let complete;
  let count = 0;
  late.connection.close = async () => { throw new Error('uncertain cleanup'); };
  const sink = amqpSink('amqp://test', { connectTimeoutMs: 15, retryMs: 5, connect() {
    count += 1;
    if (count === 1) { return Promise.resolve(initial.connection); }
    if (count === 2) { return new Promise((resolve) => { complete = resolve; }); }
    return Promise.resolve(recovered.connection);
  } });
  await sink.start();
  initial.connection.emit('close');
  await new Promise(resolve => { setTimeout(resolve, 45); });
  complete(late.connection);
  await new Promise(resolve => { setTimeout(resolve, 30); });
  const refused = await sink.start().then(() => false, () => true);
  await sink.stop().catch(() => {});
  assert.equal(refused, true, 'Sink reused a connection after uncertain cleanup');
});
