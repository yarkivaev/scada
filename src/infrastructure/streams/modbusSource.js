import pollingSource from './pollingSource.js';
import deadline from './deadline.js';
import abortable from './abortable.js';
import { attempt, create, drop, idle, opening, resume } from './modbusConnection.js';

function read(bag, address, count) {
  return async function fetch(since, until, { signal } = {}) {
    const { client } = bag;
    try {
      const result = await deadline(abortable(client.readHoldingRegisters(address, count), signal, () => { drop(client); }),
        Math.max(1, bag.interval * 1000), 'Modbus read', () => { drop(client); });
      return [result.data];
    } catch (err) {
      if (bag.client === client) { bag.lost(); }
      throw err;
    }
  };
}

/**
 * Shared Modbus polling lifecycle for TCP and RTU transports.
 *
 * @param {object} options - connect, target, address, count, interval, collector, clk, client, log
 * @returns {object} Source with start() and stop() methods
 */
function modbusPollingSource(options) {
  const { address, count, interval, collector, clk } = options;
  const bag = {
    ...options,
    client: undefined,
    state: idle(),
    epoch: 0,
    maxDelay: 300,
    delay: interval
  };
  bag.lost = function lost() {
    resume(bag);
  };
  bag.source = pollingSource(read(bag, address, count), interval, collector, clk);
  return {
    /**
     * Connects to the Modbus device and starts polling.
     */
    start() {
      if (bag.fatal) { return Promise.reject(bag.fatal); }
      if (bag.state.connected() || bag.state.retrying() || bag.state.opening()) {
        return Promise.resolve();
      }
      const token = bag.epoch;
      bag.state = opening();
      return Promise.resolve(bag.stopping).then(() => { if (token === bag.epoch) { attempt(bag); } });
    },
    /**
     * Stops polling and disconnects from the Modbus device.
     */
    stop() {
      bag.epoch += 1;
      const drained = bag.source.stop();
      if (bag.state.retrying()) {
        bag.state.cancel();
      }
      const { client } = bag;
      bag.client = undefined;
      bag.state = idle();
      drop(client);
      bag.stopping = deadline(Promise.all([drained, bag.opened]), 5000, 'Modbus stop', (error) => { bag.fatal = error; }).then(() => {
        if (bag.fatal) { throw bag.fatal; }
      });
      return bag.stopping;
    }
  };
}

/**
 * Modbus TCP polling source for reading holding registers.
 *
 * Connects to a Modbus TCP device and polls holding registers
 * at a specified interval. Forwards register arrays to the
 * collector via pollingSource.
 *
 * @example
 * const source = modbusSource('192.0.2.148', 502, 4000, 14, 5, collector, clock);
 * source.start();
 *
 * @param {string} host - Modbus TCP host address
 * @param {number} port - Modbus TCP port
 * @param {number} address - Starting register address
 * @param {number} count - Number of registers to read
 * @param {number} interval - Polling interval in seconds
 * @param {object} collector - Collector with accept() method
 * @param {object} clk - Clock with millis() method
 * @param {object} [log] - Logger with error() method for connection failures
 * @returns {object} Source with start() and stop() methods
 */
// Preserve the established positional adapter API.
// eslint-disable-next-line max-params
export default function modbusSource(host, port, address, count, interval, collector, clk, log = console) {
  if (typeof host !== 'string' || host.length === 0) {
    throw new Error('Host must be a non-empty string');
  }
  if (typeof port !== 'number' || port <= 0) {
    throw new Error(`Port must be a positive number, got: ${port}`);
  }
  if (typeof address !== 'number' || address < 0) {
    throw new Error(`Address must be a non-negative number, got: ${address}`);
  }
  if (typeof count !== 'number' || count <= 0) {
    throw new Error(`Count must be a positive number, got: ${count}`);
  }
  function connect(modbusClient) {
    return modbusClient.connectTCP(host, { port });
  }
  return modbusPollingSource({
    create,
    connect,
    target: `${host}:${port}`,
    address,
    count,
    interval,
    collector,
    clk,
    log
  });
}

/**
 * Modbus RTU polling source for reading holding registers over serial.
 *
 * Connects to a Modbus RTU device on a serial port and polls holding registers
 * at a specified interval. Forwards register arrays to the collector via pollingSource.
 *
 * @example
 * const source = modbusRtuSource('/dev/ttyUSB0', { baudRate: 9600, slaveId: 1 }, 4000, 44, 5, collector, clock);
 * source.start();
 *
 * @param {string} path - Serial device path (e.g. /dev/ttyUSB0)
 * @param {object} serial - baudRate, dataBits, stopBits, parity, slaveId
 * @param {number} address - Starting register address
 * @param {number} count - Number of registers to read
 * @param {number} interval - Polling interval in seconds
 * @param {object} collector - Collector with accept() method
 * @param {object} clk - Clock with millis() method
 * @param {object} [log] - Logger with error() method for connection failures
 * @returns {object} Source with start() and stop() methods
 */
// Preserve the established positional adapter API.
// eslint-disable-next-line max-params
export function modbusRtuSource(path, serial, address, count, interval, collector, clk, log = console) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('Serial path must be a non-empty string');
  }
  if (!serial || typeof serial !== 'object') {
    throw new Error('Serial config must be an object');
  }
  if (typeof serial.baudRate !== 'number' || serial.baudRate <= 0) {
    throw new Error(`Baud rate must be a positive number, got: ${serial.baudRate}`);
  }
  if (typeof address !== 'number' || address < 0) {
    throw new Error(`Address must be a non-negative number, got: ${address}`);
  }
  if (typeof count !== 'number' || count <= 0) {
    throw new Error(`Count must be a positive number, got: ${count}`);
  }
  const slaveId = serial.slaveId || 1;
  function connect(modbusClient) {
    return modbusClient.connectRTUBuffered(path, {
      baudRate: serial.baudRate,
      dataBits: serial.dataBits || 8,
      stopBits: serial.stopBits || 1,
      parity: serial.parity || 'none'
    }).then(() => {
      modbusClient.setID(slaveId);
    });
  }
  return modbusPollingSource({
    create,
    connect,
    target: path,
    address,
    count,
    interval,
    collector,
    clk,
    log
  });
}
