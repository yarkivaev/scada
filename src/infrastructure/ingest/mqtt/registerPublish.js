import { decodePoint } from './registerPoint.js';

/**
 * Measurement name for one mapped parameter.
 *
 * A stream path plus the parameter id is the document path. An empty
 * stream keeps the parameter id, which is the generic fallback name.
 *
 * @example
 *   measurementPath('mill/electrical', 'voltage');
 *
 * @param {string} stream - document path
 * @param {string} key - parameter id
 * @returns {string} MQTT topic
 */
export function measurementPath(stream, key) {
    if (typeof stream === 'string' && stream.length > 0) {
        return `${stream}/${key}`;
    }
    return String(key);
}

/**
 * Publish plan for one device map.
 *
 * @example
 *   measurementPlans('mill/electrical', { voltage: 'holding:4000:cdab' });
 *
 * @param {string} stream - document path
 * @param {object} mapping - parameter id to register point
 * @returns {Array<{point: string, topic: string}>} publish plan
 */
export function measurementPlans(stream, mapping) {
    return Object.keys(mapping || {}).map((key) => {
        return {
            point: String(mapping[key]),
            topic: measurementPath(stream, key)
        };
    });
}

/**
 * Publishes one MQTT record per holding-register point.
 *
 * Each record is `{topic, payload}` and the payload is JSON `{ts, value}`.
 *
 * @example
 *   const transformer = registerPublish(plans, 4000, collector);
 *   transformer.accept([0, 16256]);
 *
 * @param {Array<{point: string, topic: string}>} plans - publish plan
 * @param {number} origin - first PDU address in the window
 * @param {object} collector - collector with accept()
 * @returns {object} transformer with accept(registers)
 */
function aliveTopic(topic) {
    const parts = String(topic).split('/');
    const index = parts.indexOf('GET');
    if (index >= 0 && index + 1 < parts.length) {
        parts[index + 1] = 'source_alive';
        return parts.join('/');
    }
    parts[parts.length - 1] = 'source_alive';
    return parts.join('/');
}

function emit(collector, topic, value, ts) {
    return collector.accept({
        payload: JSON.stringify({ ts, value }),
        topic
    });
}

function marks(rows) {
    return [...new Set(rows.map((item) => { return aliveTopic(item.topic); }))];
}

export default function registerPublish(plans, origin, collector) {
    if (!collector || typeof collector.accept !== 'function') {
        throw new Error('Collector must have an accept() method');
    }
    const rows = (plans || []).map((item) => {
        return Object.freeze({
            point: item.point,
            topic: item.topic
        });
    });
    return {
        /**
         * Decodes the window and publishes one record per point.
         *
         * @param {Array<number>} registers - uint16 window
         */
        accept(registers) {
            const ts = Date.now();
            return Promise.all([
                ...rows.map((item) => {
                    return emit(collector, item.topic, decodePoint(item.point, origin, registers), ts);
                }),
                ...marks(rows).map((topic) => { return emit(collector, topic, 1, ts); })
            ]);
        },
        /**
         * Publishes a collector-clock watermark while the register source is dark.
         *
         * @param {{ts?: number}} row - collector timestamp
         */
        miss(row) {
            const ts = Number(row?.ts) || Date.now();
            return Promise.all(marks(rows).map((topic) => { return emit(collector, topic, 0, ts); }));
        }
    };
}
