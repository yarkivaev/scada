/**
 * Parses Modbus device connection specs from MODBUS_DEVICES entries.
 *
 * TCP format: name:host:port
 * RTU format: name:rtu:path:baud[:line][:slaveId]
 *
 * @example
 * parseModbusDeviceSpec('cooling-1:rtu:/dev/ttyUSB0:9600:8N1:1');
 * parseModbusDeviceSpec('icht-2:192.168.2.149:502');
 */

/**
 * Parses serial line format such as 8N1 into modbus-serial options.
 *
 * @param {string} line - Data bits, parity letter, stop bits (e.g. 8N1)
 * @returns {object} dataBits, parity, stopBits
 */
export function parseModbusLineFormat(line) {
  if (typeof line !== 'string' || line.length !== 3) {
    throw new Error(`Serial line format must be three characters such as 8N1, got: ${line}`);
  }
  const dataBits = parseInt(line.charAt(0), 10);
  const parityLetter = line.charAt(1).toUpperCase();
  const stopBits = parseInt(line.charAt(2), 10);
  let parity = '';
  if (parityLetter === 'N') {
    parity = 'none';
  } else if (parityLetter === 'E') {
    parity = 'even';
  } else if (parityLetter === 'O') {
    parity = 'odd';
  }
  if (parity.length === 0 || Number.isNaN(dataBits) || Number.isNaN(stopBits)) {
    throw new Error(`Serial line format must be such as 8N1, got: ${line}`);
  }
  return { dataBits, parity, stopBits };
}

/**
 * Parses RTU device spec parts into connection parameters.
 *
 * @param {string} spec - Full device spec string
 * @param {Array<string>} parts - Colon-separated spec parts
 * @returns {object} RTU device descriptor
 */
function parseRtuDeviceSpec(spec, parts) {
  const name = parts[0];
  const path = parts[2];
  const baudRate = parseInt(parts[3], 10);
  const line = parts[4] || '8N1';
  const slaveId = parseInt(parts[5] || '1', 10);
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error(`RTU path must be a non-empty string in spec: ${spec}`);
  }
  if (Number.isNaN(baudRate) || baudRate <= 0) {
    throw new Error(`RTU baud rate must be positive in spec: ${spec}`);
  }
  if (Number.isNaN(slaveId) || slaveId <= 0) {
    throw new Error(`RTU slave id must be positive in spec: ${spec}`);
  }
  return {
    kind: 'rtu',
    name,
    path,
    serial: {
      baudRate,
      slaveId,
      ...parseModbusLineFormat(line)
    }
  };
}

/**
 * Parses TCP device spec parts into connection parameters.
 *
 * @param {string} spec - Full device spec string
 * @param {Array<string>} parts - Colon-separated spec parts
 * @returns {object} TCP device descriptor
 */
function parseTcpDeviceSpec(spec, parts) {
  const name = parts[0];
  const host = parts[1];
  const port = parseInt(parts[2], 10);
  if (typeof host !== 'string' || host.length === 0) {
    throw new Error(`TCP host must be a non-empty string in spec: ${spec}`);
  }
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`TCP port must be positive in spec: ${spec}`);
  }
  return { kind: 'tcp', name, host, port };
}

/**
 * Parses one MODBUS_DEVICES entry into TCP or RTU connection parameters.
 *
 * @param {string} spec - Comma-separated device spec fragment
 * @returns {object} Parsed device connection descriptor
 */
export function parseModbusDeviceSpec(spec) {
  if (typeof spec !== 'string' || spec.trim().length === 0) {
    throw new Error('Device spec must be a non-empty string');
  }
  const parts = spec.trim().split(':');
  const name = parts[0];
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Device name must be a non-empty string');
  }
  if (parts[1] === 'rtu') {
    return parseRtuDeviceSpec(spec, parts);
  }
  return parseTcpDeviceSpec(spec, parts);
}
