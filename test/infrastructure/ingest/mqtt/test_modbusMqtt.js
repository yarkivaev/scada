import assert from 'node:assert';
import { describe, it } from 'mocha';
import modbusMqtt from '../../../../src/infrastructure/ingest/mqtt/modbusMqtt.js';

describe('modbusMqtt', () => {
  it('throws on empty mqtt url', () => {
    assert.throws(
      () => {return modbusMqtt('', `dev-${Math.random().toString(36).slice(2)}:localhost:502`, { interval: 5 })},
      /non-empty string/u,
      'Should reject empty MQTT URL'
    );
  });

  it('throws on empty devices string', () => {
    assert.throws(
      () => {return modbusMqtt(`mqtt://broker-${Math.random().toString(36).slice(2)}`, '', { interval: 5 })},
      /non-empty string/u,
      'Should reject empty devices string'
    );
  });

  it('throws on missing config object', () => {
    assert.throws(
      () => {return modbusMqtt(
        `mqtt://broker-${Math.random().toString(36).slice(2)}`,
        `прибор-${Math.random().toString(36).slice(2)}:localhost:502`
      )},
      /Config must be an object/u,
      'Should reject missing config'
    );
  });

  it('throws on missing transformerFactory', () => {
    assert.throws(
      () => {return modbusMqtt(
        `mqtt://broker-${Math.random().toString(36).slice(2)}`,
        `прибор-${Math.random().toString(36).slice(2)}:localhost:502`,
        { interval: 5 }
      )},
      /transformerFactory is required/u,
      'Should reject missing transformerFactory'
    );
  });

  it('accepts RTU device spec with transformerFactory', () => {
    const pipeline = modbusMqtt(
      `mqtt://broker-${Math.random().toString(36).slice(2)}`,
      `cooling-${Math.random().toString(36).slice(2)}:rtu:/dev/ttyUSB0:9600:8N1:1`,
      {
        interval: 5,
        address: 4000,
        count: 44,
        threshold: 5,
        timeout: 60,
        transformerFactory: () => {
          return { accept: () => {} };
        }
      }
    );
    assert.strictEqual(typeof pipeline.start, 'function', 'RTU device spec should produce pipeline with start');
  });
});
