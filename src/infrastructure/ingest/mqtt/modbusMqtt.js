import {
    batch,
    circuit,
    clock,
    modbusRtuBusSource,
    modbusRtuSource,
    modbusSource,
    mqttSink
} from '@yarkivaev/source-to-sink';
import { parseModbusDeviceSpec } from './modbusDeviceSpec.js';

/**
 * Builds a TCP Modbus polling source for one device.
 *
 * @param {object} device - Parsed TCP device descriptor
 * @param {object} config - Pipeline config
 * @param {object} collector - Batch collector
 * @param {object} clk - Clock instance
 * @returns {object} Modbus polling source
 */
function buildTcpSource(device, config, collector, clk) {
    const transformer = config.transformerFactory(device.name, collector);
    return modbusSource(
        device.host,
        device.port,
        config.address,
        config.count,
        config.interval,
        transformer,
        clk
    );
}

/**
 * Serial bus key for grouping RTU devices that share one port.
 *
 * @param {object} device - Parsed RTU device descriptor
 * @returns {string} Group key
 */
function rtuBusKey(device) {
    const { baudRate, dataBits, stopBits, parity } = device.serial;
    return `${device.path}|${baudRate}|${dataBits}|${stopBits}|${parity}`;
}

/**
 * Groups RTU devices by shared serial port and line settings.
 *
 * @param {Array<object>} rtuDevices - Parsed RTU device descriptors
 * @returns {Array<Array<object>>} Device groups
 */
function groupRtuDevices(rtuDevices) {
    const groups = new Map();
    for (const device of rtuDevices) {
        const key = rtuBusKey(device);
        const list = groups.get(key) || [];
        list.push(device);
        groups.set(key, list);
    }
    return [...groups.values()];
}

/**
 * Builds a single-slave RTU polling source.
 *
 * @param {object} device - Parsed RTU device
 * @param {object} config - Pipeline config
 * @param {object} collector - Batch collector
 * @param {object} clk - Clock instance
 * @returns {object} Modbus RTU source
 */
function buildSingleRtuSource(device, config, collector, clk) {
    return modbusRtuSource(
        device.path,
        device.serial,
        config.address,
        config.count,
        config.interval,
        config.transformerFactory(device.name, collector),
        clk
    );
}

/**
 * Builds a multi-slave RTU bus source for one serial port.
 *
 * @param {Array<object>} devices - RTU devices on the same port
 * @param {object} config - Pipeline config
 * @param {object} collector - Batch collector
 * @returns {object} Modbus RTU bus source
 */
function buildBusRtuSource(devices, config, collector) {
    const slaves = devices.map((device) => {
        return {
            slaveId: device.serial.slaveId,
            collector: config.transformerFactory(device.name, collector)
        };
    });
    const first = devices[0];
    return modbusRtuBusSource(first.path, first.serial, slaves, {
        address: config.address,
        count: config.count,
        interval: config.interval
    });
}

/**
 * Builds RTU sources, merging slaves on the same serial port into one bus.
 *
 * @param {Array<object>} rtuDevices - Parsed RTU device descriptors
 * @param {object} config - Pipeline config
 * @param {object} collector - Batch collector
 * @param {object} clk - Clock instance
 * @returns {Array<object>} Modbus polling sources
 */
function buildRtuSources(rtuDevices, config, collector, clk) {
    return groupRtuDevices(rtuDevices).map((devices) => {
        if (devices.length === 1) {
            return buildSingleRtuSource(devices[0], config, collector, clk);
        }
        return buildBusRtuSource(devices, config, collector);
    });
}

/**
 * Validates modbusMqtt constructor arguments.
 *
 * @param {string} mqtt - MQTT broker URL
 * @param {string} devices - Device specs string
 * @param {object} config - Pipeline config
 */
function assertModbusMqttArgs(mqtt, devices, config) {
    if (typeof mqtt !== 'string' || mqtt.length === 0) {
        throw new Error('MQTT URL must be a non-empty string');
    }
    if (typeof devices !== 'string' || devices.length === 0) {
        throw new Error('Devices must be a non-empty string');
    }
    if (!config || typeof config !== 'object') {
        throw new Error('Config must be an object');
    }
    if (typeof config.transformerFactory !== 'function') {
        throw new Error('transformerFactory is required for modbusMqtt');
    }
}

/**
 * Parses device specs and builds TCP plus RTU polling sources.
 *
 * @param {string} devices - Comma-separated device specs
 * @param {object} config - Pipeline config
 * @param {object} collector - Batch collector
 * @param {object} clk - Clock instance
 * @returns {Array<object>} Modbus polling sources
 */
function buildSources(devices, config, collector, clk) {
    const parsed = devices.split(',').map((spec) => {
        return parseModbusDeviceSpec(spec.trim());
    });
    const tcp = parsed.filter((device) => {
        return device.kind === 'tcp';
    });
    const rtu = parsed.filter((device) => {
        return device.kind === 'rtu';
    });
    return [
        ...tcp.map((device) => {
            return buildTcpSource(device, config, collector, clk);
        }),
        ...buildRtuSources(rtu, config, collector, clk)
    ];
}

/**
 * Pipeline for polling Modbus devices and publishing to MQTT.
 *
 * @param {string} mqtt - MQTT broker URL
 * @param {string} devices - Comma-separated specs: name:host:port or name:rtu:path:baud[:line][:slaveId]
 * @param {object} config - interval, address, count, threshold, timeout, clientId, transformerFactory
 * @returns {object} Pipeline with start() and stop() methods
 */
export default function modbusMqtt(mqtt, devices, config) {
    assertModbusMqttArgs(mqtt, devices, config);
    const clk = clock();
    const breaker = circuit(config.threshold, config.timeout, clk);
    const sink = mqttSink(mqtt, {
        clientId: config.clientId || 'sokol-modbus',
        qos: 1
    });
    const collector = batch(sink, 5, breaker);
    const sources = buildSources(devices, config, collector, clk);
    return {
        start() {
            sink.start();
            for (const source of sources) {
                source.start();
            }
        },
        stop() {
            for (const source of sources) {
                source.stop();
            }
        }
    };
}
