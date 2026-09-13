/**
 * Maps plant API JSON into local persistence rows for site sync.
 *
 * @example
 *   segmentRow('icht1', { name: 'on', start: '2026-01-01T00:00:00.000Z', end: '...', duration: 60 });
 */

/**
 * Maps one segment API item onto the segments table shape.
 *
 * @param {string} machine - machine id
 * @param {object} item - plant API segment
 * @returns {object} persistence row
 */
export function segmentRow(machine, item) {
    return {
        machine,
        kind: item.kind || 'phase',
        name: item.name,
        start_time: item.start || item.start_time,
        end_time: item.end || item.end_time,
        duration: item.duration,
        options: item.options,
        tags: item.tags,
        properties: item.properties,
        resolved: item.resolved !== false
    };
}

/**
 * Maps one operation API item onto the operations port shape.
 *
 * @param {string} machine - machine id fallback
 * @param {object} item - plant API operation
 * @returns {object} persistence item
 */
export function operationRow(machine, item) {
    return {
        machine: item.machine || machine,
        key: item.external_key || item.key,
        occurred_at: item.occurred_at,
        kind: item.kind,
        payload: item.payload || {}
    };
}

/**
 * Maps measurement series onto metrics sink records via a topic port.
 *
 * @param {string} machine - machine id
 * @param {object} body - plant API { items: [{ key, values }] }
 * @param {function} topic - (machine, key) => MQTT/CH topic
 * @returns {object[]} records with topic, ts, value
 */
export function measurementRows(machine, body, topic) {
    const items = body.items || [];
    return items.flatMap((series) => {
        const dest = topic(machine, series.key);
        if (!dest) {
            return [];
        }
        return (series.values || []).map((point) => {
            return { topic: dest, ts: point.timestamp, value: point.value };
        });
    });
}

/**
 * Maps one alert API item onto the alerts table shape.
 *
 * @param {string} machine - machine id
 * @param {object} item - plant API alert
 * @returns {object} persistence row
 */
export function alertRow(machine, item) {
    return {
        name: item.name,
        message: item.message,
        machine,
        severity: item.severity || 'warning',
        timestamp: item.timestamp,
        acknowledged: item.acknowledged === true
    };
}

export function listedItems(body) {
    if (Array.isArray(body)) {
        return body;
    }
    if (body && Array.isArray(body.items)) {
        return body.items;
    }
    return [];
}
