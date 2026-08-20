function asList(raw) {
    if (Array.isArray(raw)) {
        return raw;
    }
    if (typeof raw === 'string' && raw.length > 0) {
        return JSON.parse(raw);
    }
    return [];
}

/**
 * Builds a segments-exchange retag payload matching supervisor SegmentMessage.retag.
 *
 * @param {string} machine - machine id
 * @param {object} row - persisted segment with start_time, end_time, duration, name, options
 * @param {string[]} tags - operator tags
 * @param {object} properties - operator properties
 * @returns {object} STOMP JSON body
 *
 * @example
 *   retagBody('icht1', row, ['to_ladle'], {})
 */
export default function retagBody(machine, row, tags, properties) {
    const options = asList(row.options);
    const props = properties && Object.keys(properties).length > 0 ? properties : null;
    return {
        type: 'retag',
        status: 'completed',
        machine,
        name: row.name,
        start: new Date(row.start_time).getTime(),
        end: new Date(row.end_time).getTime(),
        duration: row.duration,
        tags,
        options: options.length > 0 ? options : null,
        properties: props,
        resolved: true
    };
}
