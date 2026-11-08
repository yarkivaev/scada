import addressWindow from './addressWindow.js';
import modbusMqtt from './modbusMqtt.js';
import { parsePoint } from './registerPoint.js';
import registerPublish, { measurementPlans } from './registerPublish.js';

export { measurementPlans };

/**
 * Device name used in a modbus spec.
 *
 * The document path is the name when it has no colon. An empty stream
 * gets a positional name.
 *
 * @param {string} stream - document path
 * @param {number} index - device index
 * @returns {string} spec name
 */
function deviceName(stream, index) {
    if (typeof stream !== 'string' || stream.length === 0) {
        return `device-${index}`;
    }
    if (stream.includes(':')) {
        throw new Error(`Document path must not contain a colon, got: ${stream}`);
    }
    return stream;
}

/**
 * Stream path at one device index.
 *
 * @param {object} config - pipeline config
 * @param {number} index - device index
 * @returns {string} document path or empty
 */
function streamOf(config, index) {
    const streams = Array.isArray(config.streams) ? config.streams : [];
    return typeof streams[index] === 'string' ? streams[index] : '';
}

/**
 * Point map at one device index.
 *
 * @param {object} config - pipeline config
 * @param {number} index - device index
 * @returns {object} parameter id to register point
 */
function mapOf(config, index) {
    const maps = Array.isArray(config.maps) ? config.maps : [];
    return maps[index] || {};
}

/**
 * Devices from ADDRESS urls or a MODBUS_DEVICES list.
 *
 * @param {object} config - pipeline config
 * @returns {Array<object>} connection rows
 */
function listed(config) {
    const addresses = Array.isArray(config.addresses) ? config.addresses : [];
    if (addresses.length > 0) {
        return addresses.map((address, index) => {
            const name = deviceName(streamOf(config, index), index);
            return { ...addressWindow(address, name), name };
        });
    }
    const devices = typeof config.devices === 'string' ? config.devices : '';
    if (devices.length === 0) {
        throw new Error('Modbus publish needs ADDRESS or MODBUS_DEVICES');
    }
    return devices.split(',').map((spec) => {
        const trimmed = spec.trim();
        return {
            address: undefined,
            count: undefined,
            name: trimmed.split(':')[0],
            spec: trimmed
        };
    });
}

/**
 * Requires STREAM and MAPPING to match the device count when present.
 *
 * @param {object} config - pipeline config
 * @param {number} count - device count
 */
function assertAligned(config, count) {
    const maps = Array.isArray(config.maps) ? config.maps : [];
    const streams = Array.isArray(config.streams) ? config.streams : [];
    if (maps.length > 0 && maps.length !== count) {
        throw new Error(`MAPPING has ${maps.length} maps for ${count} devices`);
    }
    if (streams.length > 0 && streams.length !== count) {
        throw new Error(`STREAM has ${streams.length} paths for ${count} devices`);
    }
}

/**
 * Requires unique device names.
 *
 * @param {Array<object>} rows - connection rows
 */
function assertNames(rows) {
    const seen = new Set();
    rows.forEach((row) => {
        if (seen.has(row.name) || row.name.length === 0) {
            throw new Error(`Device name must be unique and non-empty, got: ${row.name}`);
        }
        seen.add(row.name);
    });
}

/**
 * Lowest and highest PDU touched by a publish plan.
 *
 * @param {Array<{point: string}>} points - publish plan
 * @returns {{end: number|undefined, start: number|undefined}} span
 */
function cover(points) {
    if (points.length === 0) {
        return { end: undefined, start: undefined };
    }
    return points.reduce((box, item) => {
        const parsed = parsePoint(item.point);
        return {
            end: Math.max(box.end, parsed.address + parsed.width),
            start: Math.min(box.start, parsed.address)
        };
    }, { end: 0, start: Number.MAX_SAFE_INTEGER });
}

/**
 * Rejects a point that falls outside the poll window.
 *
 * @param {Array<{point: string}>} points - publish plan
 * @param {number} address - window start
 * @param {number} count - window length
 * @param {string} name - device name
 */
function assertFit(points, address, count, name) {
    points.forEach((item) => {
        const parsed = parsePoint(item.point);
        const index = parsed.address - address;
        if (index < 0 || index + parsed.width > count) {
            throw new Error(`Register point ${item.point} is outside ${address}+${count} on ${name}`);
        }
    });
}

/**
 * Poll window for one device.
 *
 * Query `at` and `count` win, then config, then the span of the points.
 *
 * @param {object} row - connection row
 * @param {Array<{point: string}>} points - publish plan
 * @param {object} config - pipeline config
 * @returns {{address: number, count: number}} window
 */
function resolveWindow(row, points, config) {
    const box = cover(points);
    const address = row.address ?? config.address ?? box.start;
    const count = row.count ?? config.count ?? (box.end - address);
    if (!Number.isInteger(address) || !Number.isInteger(count) || count <= 0) {
        throw new Error(`Register window is missing for ${row.name}`);
    }
    assertFit(points, address, count, row.name);
    return { address, count };
}

/**
 * One shared window for every device in the process.
 *
 * @param {Array<object>} rows - connection rows
 * @param {Array<Array<{point: string}>>} plans - publish plans
 * @param {object} config - pipeline config
 * @returns {{address: number, count: number}} window
 */
function oneWindow(rows, plans, config) {
    const windows = rows.map((row, index) => {
        return resolveWindow(row, plans[index], config);
    });
    const first = windows[0];
    const mismatch = windows.some((item) => {
        return item.address !== first.address || item.count !== first.count;
    });
    if (mismatch) {
        throw new Error('Modbus collectors on one process must share one register window');
    }
    return first;
}

/**
 * Publish plans in device order.
 *
 * @param {Array<object>} rows - connection rows
 * @param {object} config - pipeline config
 * @returns {Array<Array<{point: string, topic: string}>>} plans
 */
function plansFor(rows, config) {
    if (config.plans !== undefined) {
        if (!Array.isArray(config.plans) || config.plans.length !== rows.length
            || config.plans.some((plan) => { return !Array.isArray(plan) || plan.length === 0; })) {
            throw new TypeError('Publish plans must contain one non-empty array per device');
        }
        if (config.maps?.length) { throw new TypeError('Explicit plans cannot be combined with MAPPING'); }
        const topics = new Set();
        return config.plans.map((plan) => {
            return plan.map((item) => {
                if (!item || typeof item.point !== 'string' || typeof item.topic !== 'string'
                    || !item.topic.trim() || /[+#\0]/u.test(item.topic)) {
                    throw new TypeError('Publish plan requires a register point and a concrete MQTT topic');
                }
                if (!/^holding:\d+(?::(?:abcd|cdab))?$/u.test(item.point)) {
                    throw new TypeError(`Invalid register point: ${item.point}`);
                }
                const parsed = parsePoint(item.point);
                if (!Number.isSafeInteger(parsed.address) || parsed.address + parsed.width > 65536) {
                    throw new TypeError(`Register point exceeds holding-register bounds: ${item.point}`);
                }
                if (topics.has(item.topic)) { throw new TypeError(`Duplicate publish topic: ${item.topic}`); }
                topics.add(item.topic);
                return { point: item.point, topic: item.topic };
            });
        });
    }
    return rows.map((row, index) => {
        return measurementPlans(streamOf(config, index), mapOf(config, index));
    });
}

/**
 * Validates modbusPublish arguments.
 *
 * @param {string} mqtt - MQTT broker URL
 * @param {object} config - pipeline config
 */
function assertPublish(mqtt, config) {
    if (typeof mqtt !== 'string' || mqtt.length === 0) {
        throw new Error('MQTT URL must be a non-empty string');
    }
    if (!config || typeof config !== 'object') {
        throw new Error('Config must be an object');
    }
    if (typeof config.interval !== 'number' || typeof config.threshold !== 'number') {
        throw new Error('interval, threshold, and timeout must be numbers');
    }
    if (typeof config.timeout !== 'number') {
        throw new Error('interval, threshold, and timeout must be numbers');
    }
}

/**
 * Polls Modbus and publishes explicit per-device plans or STREAM and MAPPING.
 * config.plans is an array of [{ point, topic }] arrays aligned with devices.
 * Explicit plans replace generated mappings; combining the two is rejected.
 *
 * A point is `holding:<pdu>`, `holding:<pdu>:abcd`, or `holding:<pdu>:cdab`.
 * The topic is the document path `stream/parameter`. Devices come from
 * ADDRESS urls or a MODBUS_DEVICES list. One process shares one window.
 *
 * @example
 *   const pipeline = modbusPublish('mqtt://127.0.0.1:1883', {
 *     addresses: ['modbus://192.0.2.11:502?at=4000&count=2'],
 *     interval: 5,
 *     maps: [{ voltage: 'holding:4000:abcd' }],
 *     streams: ['mill/electrical'],
 *     threshold: 5,
 *     timeout: 60
 *   });
 *   pipeline.start();
 *
 * @param {string} mqtt - MQTT broker URL
 * @param {object} config - addresses or devices, streams, maps, interval, threshold, timeout
 * @returns {object} pipeline with start() and stop()
 */
export default function modbusPublish(mqtt, config) {
    assertPublish(mqtt, config);
    const rows = listed(config);
    assertAligned(config, rows.length);
    assertNames(rows);
    const plans = plansFor(rows, config);
    const frame = oneWindow(rows, plans, config);
    const specs = rows.map((row) => {
        return row.spec;
    }).join(',');
    const byName = new Map(rows.map((row, index) => {
        return [row.name, plans[index]];
    }));
    return modbusMqtt(mqtt, specs, {
        budget: config.budget,
        onFatal: config.onFatal,
        maxRecords: config.maxRecords,
        maxBytes: config.maxBytes,
        writeTimeoutMs: config.writeTimeoutMs,
        address: frame.address,
        clientId: config.clientId || 'scada-modbus',
        count: frame.count,
        interval: config.interval,
        threshold: config.threshold,
        timeout: config.timeout,
        transformerFactory(name, collector) {
            const plan = byName.get(name);
            if (!plan) {
                throw new Error(`Modbus device ${name} has no map`);
            }
            return registerPublish(plan, frame.address, collector);
        }
    });
}
