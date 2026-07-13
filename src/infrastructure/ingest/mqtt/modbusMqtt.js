import {
    batch,
    circuit,
    clock,
    modbusRtuSource,
    modbusSource,
    mqttSink
} from '@yarkivaev/source-to-sink';
import { parseModbusDeviceSpec } from './modbusDeviceSpec.js';

/**
 * Builds Modbus polling sources for one device spec.
 *
 * @param {string} spec - Device connection spec
 * @param {object} config - Pipeline config with address, count, interval, transformerFactory
 * @param {object} collector - Batch collector for transformed records
 * @param {object} clk - Clock instance
 * @returns {object} Modbus polling source
 */
function buildModbusSource(spec, config, collector, clk) {
    const device = parseModbusDeviceSpec(spec);
    const transformer = config.transformerFactory(device.name, collector);
    if (device.kind === 'rtu') {
        return modbusRtuSource(
            device.path,
            device.serial,
            config.address,
            config.count,
            config.interval,
            transformer,
            clk
        );
    }
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
 * Pipeline for polling Modbus devices and publishing to MQTT.
 *
 * @param {string} mqtt - MQTT broker URL
 * @param {string} devices - Comma-separated device specs as name:host:port or name:rtu:path:baud[:line][:slaveId]
 * @param {object} config - interval, address, count, threshold, timeout, clientId, transformerFactory
 * @returns {object} Pipeline with start() and stop() methods
 */
export default function modbusMqtt(mqtt, devices, config) {
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
    const clk = clock();
    const breaker = circuit(config.threshold, config.timeout, clk);
    const sink = mqttSink(mqtt, {
        clientId: config.clientId || 'sokol-modbus',
        qos: 1
    });
    const collector = batch(sink, 5, breaker);
    const sources = devices.split(',').map((spec) => {
        return buildModbusSource(spec, config, collector, clk);
    });
    return {
        /**
         * Starts the pipeline.
         */
        start() {
            sink.start();
            for (const source of sources) {
                source.start();
            }
        },
        /**
         * Stops the pipeline.
         */
        stop() {
            for (const source of sources) {
                source.stop();
            }
        }
    };
}
