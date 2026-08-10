import assert from 'node:assert';
import { describe, it } from 'mocha';
import { parseModbusDeviceSpec, parseModbusLineFormat } from '../../../../src/infrastructure/ingest/mqtt/modbusDeviceSpec.js';

describe('parseModbusLineFormat', () => {
  it('parses 8N1 into modbus-serial serial options', () => {
    const line = parseModbusLineFormat('8N1');
    assert.strictEqual(line.parity, 'none', '8N1 parity should map to none');
  });
});

describe('parseModbusDeviceSpec', () => {
  it('parses TCP device spec', () => {
    const suffix = Math.random().toString(36).slice(2);
    const spec = parseModbusDeviceSpec(`m-${suffix}:192.0.2.11:502`);
    assert.strictEqual(spec.kind, 'tcp', 'Legacy host:port spec should parse as tcp');
  });

  it('parses RTU device spec with defaults', () => {
    const suffix = Math.random().toString(36).slice(2);
    const spec = parseModbusDeviceSpec(`cooling-${suffix}:rtu:/dev/ttyUSB0:9600`);
    assert.strictEqual(spec.serial.slaveId, 1, 'RTU spec without slave id should default slave id to 1');
  });

  it('parses RTU device spec with line and slave id', () => {
    const suffix = Math.random().toString(36).slice(2);
    const spec = parseModbusDeviceSpec(`cooling-${suffix}:rtu:/dev/ttyUSB0:9600:8E1:2`);
    assert.strictEqual(spec.serial.parity, 'even', 'RTU spec should parse parity from line format');
  });
});
