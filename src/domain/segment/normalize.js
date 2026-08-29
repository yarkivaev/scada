/**
 * Normalizes a parsed segment message into a persistence-ready record.
 *
 * @param {object} parsed - decoded STOMP JSON payload
 * @returns {object} normalized segment record
 *
 * @example
 *   const row = segmentNormalize({ machine: 'm1', name: 'on', start: 1, end: 2, duration: 1 });
 */
export default function segmentNormalize(parsed) {
    if (typeof parsed.machine !== 'string') {
        throw new Error('Segment missing machine field');
    }
    if (typeof parsed.name !== 'string') {
        throw new Error('Segment missing name field');
    }
    const hasOpts = Array.isArray(parsed.options) && parsed.options.length > 0;
    const resolved = typeof parsed.resolved === 'boolean' ? parsed.resolved : !hasOpts;
    return {
        type: parsed.type,
        machine: parsed.machine,
        name: parsed.name,
        kind: typeof parsed.kind === 'string' && parsed.kind.length > 0 ? parsed.kind : 'phase',
        start_time: new Date(parsed.start).toISOString(),
        end_time: new Date(parsed.end).toISOString(),
        duration: parsed.duration,
        options: parsed.options ? JSON.stringify(parsed.options) : null,
        tags: parsed.tags ? JSON.stringify(parsed.tags) : null,
        properties: parsed.properties ? JSON.stringify(parsed.properties) : null,
        resolved
    };
}
