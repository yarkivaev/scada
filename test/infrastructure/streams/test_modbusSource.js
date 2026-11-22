import assert from 'node:assert';
import net from 'node:net';
import { describe, it } from 'mocha';
import ModbusRTU from 'modbus-serial';
import modbusSource from '../../../src/infrastructure/streams/modbusSource.js';
import fakeClock from './fakeClock.js';

/**
 * TCP listener that counts concurrent sockets on an ephemeral port.
 *
 * @returns {Promise<object>} Gate with port, live, peak, close
 */
function countingListen() {
    let live = 0;
    let peak = 0;
    const sockets = new Set();
    const server = net.createServer((sock) => {
        live += 1;
        if (live > peak) {
            peak = live;
        }
        sockets.add(sock);
        sock.on('close', () => {
            sockets.delete(sock);
            live -= 1;
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            resolve({
                port: server.address().port,
                live() {
                    return live;
                },
                peak() {
                    return peak;
                },
                close() {
                    for (const sock of sockets) {
                        sock.destroy();
                    }
                    return new Promise((done) => {
                        server.close(done);
                    });
                }
            });
        });
    });
}

/**
 * Resolves after the given delay.
 *
 * @param {number} ms - Delay in milliseconds
 * @returns {Promise<void>} Timer promise
 */
function settle(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/**
 * Collects unhandledRejection events until stop().
 *
 * @returns {object} Collector with seen() and stop()
 */
function watchRejects() {
    const seen = [];
    function onReject(err) {
        seen.push(err);
    }
    process.on('unhandledRejection', onReject);
    return {
        seen() {
            return seen.length;
        },
        stop() {
            process.off('unhandledRejection', onReject);
        }
    };
}

/**
 * Waits until probe is true or the timeout elapses.
 *
 * @param {Function} probe - Condition
 * @param {number} limit - Timeout in milliseconds
 * @returns {Promise<void>} Resolves when probe holds
 */
function until(probe, limit) {
    const deadline = Date.now() + limit;
    function tick(resolve, reject) {
        if (probe()) {
            resolve();
            return;
        }
        if (Date.now() >= deadline) {
            reject(new Error('condition did not hold before timeout'));
            return;
        }
        setTimeout(() => {
            tick(resolve, reject);
        }, 20);
    }
    return new Promise(tick);
}

/**
 * TCP listener that counts accepted sockets and can drop them.
 *
 * @returns {Promise<object>} Gate with port, accepted, drop, close
 */
function sessionListen() {
    let accepted = 0;
    const sockets = new Set();
    const server = net.createServer((sock) => {
        accepted += 1;
        sockets.add(sock);
        sock.on('close', () => {
            sockets.delete(sock);
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            resolve({
                port: server.address().port,
                accepted() {
                    return accepted;
                },
                drop() {
                    for (const sock of sockets) {
                        sock.destroy();
                    }
                },
                close() {
                    for (const sock of sockets) {
                        sock.destroy();
                    }
                    return new Promise((done) => {
                        server.close(done);
                    });
                }
            });
        });
    });
}

/**
 * Builds a Modbus TCP Read Holding Registers response.
 *
 * @param {Buffer} req - Request frame
 * @param {number[]} values - Register values
 * @returns {Buffer} Response frame
 */
function holding(req, values) {
    const tid = req.readUInt16BE(0);
    const uid = req.readUInt8(6);
    const bytes = values.length * 2;
    const out = Buffer.alloc(9 + bytes);
    out.writeUInt16BE(tid, 0);
    out.writeUInt16BE(0, 2);
    out.writeUInt16BE(3 + bytes, 4);
    out.writeUInt8(uid, 6);
    out.writeUInt8(3, 7);
    out.writeUInt8(bytes, 8);
    for (let i = 0; i < values.length; i += 1) {
        out.writeUInt16BE(values[i], 9 + i * 2);
    }
    return out;
}

/**
 * TCP listener that stays silent on the first socket then answers later ones.
 *
 * @param {number[]} values - Holding register values
 * @returns {Promise<object>} Gate with port, accepted, close
 */
function recoverListen(values) {
    let accepted = 0;
    const sockets = new Set();
    const server = net.createServer((sock) => {
        accepted += 1;
        sockets.add(sock);
        sock.on('close', () => {
            sockets.delete(sock);
        });
        if (accepted === 1) {
            return;
        }
        sock.on('data', (req) => {
            if (req.length >= 12 && req.readUInt8(7) === 3) {
                sock.write(holding(req, values));
            }
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            resolve({
                port: server.address().port,
                accepted() {
                    return accepted;
                },
                close() {
                    for (const sock of sockets) {
                        sock.destroy();
                    }
                    return new Promise((done) => {
                        server.close(done);
                    });
                }
            });
        });
    });
}

describe('modbusSource', () => {
  it('throws on empty host', () => {
    const collector = { accept: () => {} };
    const clk = fakeClock(Math.floor(Math.random() * 10000));
    assert.throws(
      () => {return modbusSource('', 502, 4000, 14, 5, collector, clk)},
      /Host must be a non-empty string/u,
      'Should reject empty host'
    );
  });

  it('throws on missing host', () => {
    const collector = { accept: () => {} };
    const clk = fakeClock(Math.floor(Math.random() * 10000));
    assert.throws(
      () => {return modbusSource(null, 502, 4000, 14, 5, collector, clk)},
      /Host must be a non-empty string/u,
      'Should reject null host'
    );
  });

  it('throws on invalid port', () => {
    const collector = { accept: () => {} };
    const clk = fakeClock(Math.floor(Math.random() * 10000));
    assert.throws(
      () => {return modbusSource('192.168.2.148', -1, 4000, 14, 5, collector, clk)},
      /Port must be a positive number/u,
      'Should reject negative port'
    );
  });

  it('throws on negative address', () => {
    const collector = { accept: () => {} };
    const clk = fakeClock(Math.floor(Math.random() * 10000));
    assert.throws(
      () => {return modbusSource('192.168.2.148', 502, -1, 14, 5, collector, clk)},
      /Address must be a non-negative number/u,
      'Should reject negative address'
    );
  });

  it('throws on invalid count', () => {
    const collector = { accept: () => {} };
    const clk = fakeClock(Math.floor(Math.random() * 10000));
    assert.throws(
      () => {return modbusSource('192.168.2.148', 502, 4000, 0, 5, collector, clk)},
      /Count must be a positive number/u,
      'Should reject zero count'
    );
  });

  it('throws on missing collector', () => {
    const clk = fakeClock(Math.floor(Math.random() * 10000));
    assert.throws(
      () => {return modbusSource('192.168.2.148', 502, 4000, 14, 5, null, clk)},
      /Collector must have an accept\(\) method/u,
      'Should reject null collector'
    );
  });

  it('throws on missing clock', () => {
    const collector = { accept: () => {} };
    assert.throws(
      () => {return modbusSource('192.168.2.148', 502, 4000, 14, 5, collector, null)},
      /Clock must have a millis\(\) method/u,
      'Should reject null clock'
    );
  });

  it('creates source with start and stop methods', () => {
    const collector = { accept: () => {} };
    const clk = fakeClock(Math.floor(Math.random() * 10000));
    const source = modbusSource(`\u00e9${Math.random()}`, 502, 4000, 14, 5, collector, clk);
    assert.strictEqual(typeof source.start, 'function', 'Should have start method');
  });

  it('creates source with stop method', () => {
    const collector = { accept: () => {} };
    const clk = fakeClock(Math.floor(Math.random() * 10000));
    const source = modbusSource(`\u4e2d${Math.random()}`, 502, 4000, 14, 5, collector, clk);
    assert.strictEqual(typeof source.stop, 'function', 'Should have stop method');
  });

  it('stops without error when not started', () => {
    const collector = { accept: () => {} };
    const clk = fakeClock(Math.floor(Math.random() * 10000));
    const source = modbusSource(`\u3042${Math.random()}`, 502, 4000, 14, 5, collector, clk);
    source.stop();
    assert.strictEqual(true, true, 'Should not throw when stopping without start');
  });

  it('retries connection on failure', async () => {
    let logged = false;
    const log = { error: () => { logged = true; } };
    const collector = { accept: () => {} };
    const clk = fakeClock(Math.floor(Math.random() * 10000));
    const port = 65000 + Math.floor(Math.random() * 500);
    const source = modbusSource('127.0.0.1', port, 4000, 14, 5, collector, clk, log);
    source.start();
    await new Promise(resolve => { setTimeout(resolve, 200); });
    source.stop();
    assert.strictEqual(logged, true, 'Should log connection failure and retry');
  });

  it('does not crash process on connection failure', async () => {
    const log = { error: () => {} };
    const collector = { accept: () => {} };
    const clk = fakeClock(Math.floor(Math.random() * 10000));
    const port = 65000 + Math.floor(Math.random() * 500);
    const source = modbusSource('127.0.0.1', port, 4000, 14, 5, collector, clk, log);
    source.start();
    await new Promise(resolve => { setTimeout(resolve, 200); });
    source.stop();
    assert.strictEqual(true, true, 'Should not crash on unreachable host');
  });

  it('does not emit unhandled rejection after connection retry', async function() {
    this.timeout(4000);
    const watch = watchRejects();
    const log = { error() {} };
    const port = 65000 + Math.floor(Math.random() * 500);
    const source = modbusSource(
      '127.0.0.1',
      port,
      4000,
      14,
      0.05,
      { accept() {} },
      fakeClock(1 + Math.floor(Math.random() * 100)),
      log
    );
    source.start();
    await settle(400);
    source.stop();
    watch.stop();
    assert.strictEqual(watch.seen(), 0, 'retry leaked an unhandled rejection');
  });

  it('does not open a second TCP socket when start is called twice', async function() {
    const gate = await countingListen();
    const source = modbusSource(
      '127.0.0.1',
      gate.port,
      4000,
      14,
      5,
      { accept() {} },
      fakeClock(1 + Math.floor(Math.random() * 100)),
      { error() {} }
    );
    source.start();
    await until(() => {
      return gate.live() >= 1;
    }, 2000);
    source.start();
    await settle(150);
    const peak = gate.peak();
    source.stop();
    await gate.close();
    assert.strictEqual(peak, 1, 'second start opened another Modbus TCP socket');
  });

  it('closes the TCP socket when stop is called after connect', async function() {
    const gate = await countingListen();
    const source = modbusSource(
      '127.0.0.1',
      gate.port,
      4000,
      14,
      5,
      { accept() {} },
      fakeClock(3 + Math.floor(Math.random() * 100)),
      { error() {} }
    );
    source.start();
    await until(() => {
      return gate.live() >= 1;
    }, 2000);
    source.stop();
    await until(() => {
      return gate.live() === 0;
    }, 2000);
    const live = gate.live();
    await gate.close();
    assert.strictEqual(live, 0, 'stop after connect left a Modbus TCP socket open');
  });

  it('does not keep a TCP socket when stop is called during connect', async function() {
    const gate = await countingListen();
    const source = modbusSource(
      '127.0.0.1',
      gate.port,
      4000,
      14,
      5,
      { accept() {} },
      fakeClock(7 + Math.floor(Math.random() * 100)),
      { error() {} }
    );
    source.start();
    source.stop();
    await settle(400);
    const live = gate.live();
    await gate.close();
    assert.strictEqual(live, 0, 'stop during connect left a Modbus TCP socket open');
  });

  it('aborts a never-resolving holding-register read at the poll deadline', async function() {
    this.timeout(2000);
    const original = {
      connectTCP: ModbusRTU.prototype.connectTCP,
      readHoldingRegisters: ModbusRTU.prototype.readHoldingRegisters,
      setTimeout: ModbusRTU.prototype.setTimeout,
      destroy: ModbusRTU.prototype.destroy
    };
    let dropped = 0;
    ModbusRTU.prototype.connectTCP = function connectTCP() { return Promise.resolve(); };
    ModbusRTU.prototype.setTimeout = function setTimeout() {};
    ModbusRTU.prototype.readHoldingRegisters = function readHoldingRegisters() { return new Promise(() => {}); };
    ModbusRTU.prototype.destroy = function destroy(done) { dropped += 1; done?.(); };
    const source = modbusSource(
      '127.0.0.1',
      1 + Math.floor(Math.random() * 60000),
      0,
      1,
      0.05,
      { accept() {} },
      fakeClock(1000 + Math.floor(Math.random() * 900)),
      { error() {} }
    );
    try {
      source.start();
      await settle(400);
      assert.ok(dropped > 0, 'hung holding-register read was not aborted');
    } finally {
      await source.stop().catch(() => {});
      Object.assign(ModbusRTU.prototype, original);
    }
  });

  it('opens a new TCP socket after the device stays silent or drops the session', async function() {
    this.timeout(6000);
    const gate = await sessionListen();
    const source = modbusSource(
      '127.0.0.1',
      gate.port,
      4000,
      3 + Math.floor(Math.random() * 8),
      0.05,
      { accept() {} },
      fakeClock(11 + Math.floor(Math.random() * 100)),
      { error() {} }
    );
    source.start();
    await until(() => {
      return gate.accepted() >= 1;
    }, 2000);
    await settle(80);
    gate.drop();
    await until(() => {
      return gate.accepted() >= 2;
    }, 3000);
    const accepted = gate.accepted();
    source.stop();
    await gate.close();
    assert.ok(accepted >= 2, 'silent or dropped session did not open a new Modbus TCP socket');
  });

  it('forwards a new sample after the device answers again', async function() {
    this.timeout(6000);
    const count = 3 + Math.floor(Math.random() * 6);
    const values = Array.from({ length: count }, () => {
      return 1000 + Math.floor(Math.random() * 500);
    });
    const samples = [];
    const gate = await recoverListen(values);
    const source = modbusSource(
      '127.0.0.1',
      gate.port,
      4000,
      count,
      0.05,
      {
        accept(entry) {
          samples.push(entry);
        }
      },
      fakeClock(13 + Math.floor(Math.random() * 100)),
      { error() {} }
    );
    source.start();
    await until(() => {
      return samples.length >= 1;
    }, 4000);
    const sample = samples[0];
    source.stop();
    await gate.close();
    assert.deepStrictEqual(sample, values, 'restored device did not deliver a new sample');
  });
});
