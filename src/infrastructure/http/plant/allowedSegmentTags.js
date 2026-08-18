/**
 * Normalizes a tags or options field that may be an array or JSON string.
 *
 * @param {unknown} raw - stored field
 * @returns {Array<string>} id list
 */
function asIds(raw) {
    if (Array.isArray(raw)) {
        return raw.filter((id) => {
            return typeof id === 'string';
        });
    }
    if (typeof raw === 'string' && raw.length > 0) {
        const parsed = JSON.parse(raw);
        return asIds(parsed);
    }
    return [];
}

/**
 * Returns whether requested tags are inside published options or already standing.
 * Empty options mean no restriction so older publishers keep working.
 *
 * @param {unknown} options - published option ids
 * @param {unknown} standing - tags already on the segment
 * @param {unknown} tags - tags the operator wants to write
 * @returns {boolean} true when every requested tag is allowed
 * @example
 *   allowedSegmentTags(['load'], [], ['load'])
 */
export default function allowedSegmentTags(options, standing, tags) {
    const allow = asIds(options);
    if (allow.length === 0) {
        return true;
    }
    const held = new Set(asIds(standing));
    const published = new Set(allow);
    return asIds(tags).every((id) => {
        return published.has(id) || held.has(id);
    });
}
