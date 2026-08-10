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
        `device-${Math.random().toString(36).slice(2)}:localhost:502`
      )},
      /Config must be an object/u,
      'Should reject missing config'
    );
  });

  it('throws on missing transformerFactory', () => {
    assert.throws(
      () => {return modbusMqtt(
        `mqtt://broker-${Math.random().toString(36).slice(2)}`,
        `device-${Math.random().toString(36).slice(2)}:localhost:502`,
        { interval: 5 }
      )},
      /transformerFactory is required/u,
      'Should reject missing transformerFactory'
    );
  });

  it('accepts multiple RTU slaves on one serial path', () => {
    const path = `/dev/ttyUSB${Math.floor(Math.random() * 9)}`;
    const pipeline = modbusMqtt(
      `mqtt://broker-${Math.random().toString(36).slice(2)}`,
      `m-1:rtu:${path}:9600:8N2:1,m-2:rtu:${path}:9600:8N2:2`,
      {
        interval: 5,
        address: 1280,
        count: 30,
        threshold: 5,
        timeout: 60,
        transformerFactory: () => {
          return { accept: () => {} };
        }
      }
    );
    assert.strictEqual(typeof pipeline.start, 'function', 'Shared RTU bus should produce pipeline with start');
  });
});
