import assert from 'node:assert';
import { describe, it } from 'mocha';
import { modbusRtuSource } from '../../../src/infrastructure/streams/modbusSource.js';
import fakeClock from './fakeClock.js';

describe('modbusRtuSource', () => {
  it('throws on empty serial path', () => {
    const collector = { accept: () => {} };
    const clk = fakeClock(Math.floor(Math.random() * 10000));
    assert.throws(
      () => {return modbusRtuSource('', { baudRate: 9600 }, 4000, 44, 5, collector, clk)},
      /Serial path must be a non-empty string/u,
      'Should reject empty serial path'
    );
  });

  it('throws on invalid baud rate', () => {
    const collector = { accept: () => {} };
    const clk = fakeClock(Math.floor(Math.random() * 10000));
    assert.throws(
      () => {return modbusRtuSource('/dev/ttyUSB0', { baudRate: 0 }, 4000, 44, 5, collector, clk)},
      /Baud rate must be a positive number/u,
      'Should reject zero baud rate'
    );
  });

  it('creates source with start method', () => {
    const collector = { accept: () => {} };
    const clk = fakeClock(Math.floor(Math.random() * 10000));
    const source = modbusRtuSource(`/dev/ttyUSB${Math.floor(Math.random() * 9)}`, { baudRate: 9600 }, 4000, 44, 5, collector, clk);
    assert.strictEqual(typeof source.start, 'function', 'Should expose start method for RTU source');
  });

  it('retries connection on failure', async function () {
    this.timeout(12000);
    const failures = [];
    let repeated;
    const retried = new Promise(resolve => { repeated = resolve; });
    const log = { error(message) {
      failures.push(message);
      if (failures.length === 2) { repeated(); }
    } };
    const collector = { accept: () => {} };
    const clk = fakeClock(Math.floor(Math.random() * 10000));
    const source = modbusRtuSource(`/dev/tty\u044b${Math.random()}`, { baudRate: 9600 }, 4000, 44, 0.05, collector, clk, log);
    const timer = setTimeout(repeated, 6000);
    try {
      await source.start();
      await retried;
      assert.strictEqual(failures.length, 2, 'Should retry the failed RTU connection');
      assert.match(failures[0], /failed, retrying in 0\.05s/u);
      assert.match(failures[1], /failed, retrying in 0\.1s/u);
    } finally {
      clearTimeout(timer);
      await source.stop();
    }
  });
});
