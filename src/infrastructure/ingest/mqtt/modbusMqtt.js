import {
    batch,
    circuit,
    clock,
    modbusSource,
    mqttSink
} from '@yarkivaev/source-to-sink';

/**
 * Pipeline for polling Modbus devices and publishing to MQTT.
 *
 * @param {string} mqtt - MQTT broker URL
 * @param {string} devices - Comma-separated device specs as name:host:port
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
        const [name, host, port] = spec.trim().split(':');
        const transformer = config.transformerFactory(name, collector);
        return modbusSource(
            host,
            parseInt(port, 10),
            config.address,
            config.count,
            config.interval,
            transformer,
            clk
        );
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
