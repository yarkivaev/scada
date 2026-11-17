/**
 * Stored edge segment as the body central must apply.
 * The live segment upsert omits tags, so this body is the copy that carries them.
 *
 * {{{
 * contourBody({ machine: 'icht2', kind: 'phase', name: 'off', start_time: new Date(1), end_time: new Date(2), duration: 1, tags: '["heating"]', properties: '{}', options: null, resolved: true, consumed: true, updated_at: new Date(3) })
 * }}}
 */

function parsed(value) {
    if (value === null || value === undefined) { return null; }
    return typeof value === 'string' ? JSON.parse(value) : value;
}

/** Cursor older than every stored segment row. */
export function contourEpoch() {
    return { at: new Date(0), machine: '', kind: '', start: new Date(0) };
}

/** Keyset position of one stored segment row. */
export function contourKey(row) {
    return { at: new Date(row.updated_at), machine: row.machine, kind: row.kind, start: new Date(row.start_time) };
}

/** Wire body for one stored edge segment, including operator tags and properties. */
export function contourBody(row) {
    return {
        type: 'contour',
        machine: row.machine,
        kind: row.kind,
        name: row.name,
        start: new Date(row.start_time).getTime(),
        end: new Date(row.end_time).getTime(),
        duration: Number(row.duration),
        tags: parsed(row.tags),
        properties: parsed(row.properties),
        options: parsed(row.options),
        resolved: row.resolved === true,
        consumed: row.consumed !== false,
        storedAt: new Date(row.updated_at).toISOString()
    };
}
