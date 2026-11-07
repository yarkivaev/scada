import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { describe, it } from 'mocha';
import mqttSource from '../../../src/infrastructure/streams/mqttSource.js';

describe('mqttSource', () => {
  it('throws on missing url', () => {
    const collector = { accept: () => {} };
    assert.throws(
      () => {return mqttSource(null, 'test/topic', collector)},
      /URL must be a non-empty string/u,
      'Should reject missing url'
    );
  });

  it('throws on empty url', () => {
    const collector = { accept: () => {} };
    assert.throws(
      () => {return mqttSource('', 'test/topic', collector)},
      /URL must be a non-empty string/u,
      'Should reject empty url'
    );
  });

  it('throws on empty topic', () => {
    const collector = { accept: () => {} };
    assert.throws(
      () => {return mqttSource('mqtt://localhost:1883', '', collector)},
      /Topic must be a non-empty string/u,
      'Should reject empty topic'
    );
  });

  it('throws on missing collector', () => {
    assert.throws(
      () => {return mqttSource('mqtt://localhost:1883', 'test', null)},
      /Collector must have an accept\(\) method/u,
      'Should reject missing collector'
    );
  });

  it('returns source with start and stop methods', () => {
    const collector = { accept: () => {} };
    const source = mqttSource('mqtt://localhost:1883', 'test/topic', collector);
    assert.strictEqual(typeof source.start, 'function', 'Should have start method');
    assert.strictEqual(typeof source.stop, 'function', 'Should have stop method');
  });

  it('accepts optional options parameter', () => {
    const collector = { accept: () => {} };
    const source = mqttSource('mqtt://localhost:1883', 'test/topic', collector, { clientId: 'test-client' });
    assert.strictEqual(typeof source.start, 'function', 'Should have start method');
    assert.strictEqual(typeof source.stop, 'function', 'Should have stop method');
  });
});

describe('MQTT subscription readiness', () => {
  it('waits for successful SUBACK and reports denied subscriptions', async () => {
    const client = new EventEmitter(); const pending = []; const errors = []; let ready = 0;
    client.subscribe = (_topics, _options, callback) => { pending.push(callback); };
    client.end = (_force, _options, done) => { done?.(); };
    const source = mqttSource('mqtt://broker', 'wire/#', { accept() {} }, {
      connect() { return client; }, onReady() { ready += 1; }, onError(error) { errors.push(error); }
    });
    source.start(); client.emit('connect');
    assert.equal(ready, 0, 'CONNECT does not prove subscription acceptance');
    pending.shift()(new Error('ACL denied'));
    assert.equal(errors.length, 1); assert.equal(ready, 0);
    client.emit('connect'); pending.shift()(null, [{ topic: 'wire/#', qos: 1 }]);
    assert.equal(ready, 1);
    await source.stop();
  });
});
