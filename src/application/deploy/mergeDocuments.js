/**
 * Reports whether a value is a plain map.
 *
 * @param {*} value - candidate
 * @returns {boolean} true for a non-null object that is not an array
 * @example
 *   isMap({ id: 'cell' });
 */
function isMap(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deep-merges two maps. A null value removes that key.
 *
 * @param {object|undefined} left - base map
 * @param {object|undefined} right - overlay
 * @returns {object} merged map
 * @example
 *   mergeMaps({ secret: 'pg' }, { image: 'plant:1' });
 */
export function mergeMaps(left, right) {
    const value = { ...(left || {}) };
    Object.keys(right || {}).forEach((key) => {
        const next = right[key];
        if (next === null) {
            delete value[key];
            return;
        }
        if (isMap(value[key]) && isMap(next)) {
            value[key] = mergeMaps(value[key], next);
            return;
        }
        value[key] = next;
    });
    return value;
}

/**
 * Merges namespace trees by node id.
 *
 * @param {object[]|undefined} left - base nodes
 * @param {object[]|undefined} right - overlay nodes
 * @returns {object[]} merged nodes
 * @example
 *   mergeNodes([{ id: 'mill', nodes: [{ id: 'a' }] }], [{ id: 'mill', nodes: [{ id: 'b' }] }]);
 */
function mergeNodes(left, right) {
    const value = new Map();
    (left || []).forEach((node) => {
        value.set(node.id, node);
    });
    (right || []).forEach((node) => {
        const prior = value.get(node.id);
        if (!prior) {
            value.set(node.id, node);
            return;
        }
        const next = { ...prior, ...node };
        const nodes = mergeNodes(prior.nodes, node.nodes);
        if (nodes.length > 0) {
            next.nodes = nodes;
        } else {
            delete next.nodes;
        }
        value.set(node.id, next);
    });
    return Array.from(value.values());
}

/**
 * Overlays one system document on another.
 *
 * Maps and namespace trees merge. Listed servers replace. A `null`
 * app drops that app. Omitted keys stay from the catalog.
 *
 * @param {object} base - catalog document
 * @param {object} extra - contour overlay
 * @returns {object} combined document
 * @example
 *   mergeDocuments({ servers: [{ id: 'cell' }] }, { servers: [{ id: 'lab' }] });
 */
export default function mergeDocuments(base, extra) {
    const document = { ...base, ...extra };
    if (base.templates || extra.templates) {
        document.templates = { ...(base.templates || {}), ...(extra.templates || {}) };
    }
    if (base.mappings || extra.mappings) {
        document.mappings = mergeMaps(base.mappings, extra.mappings);
    }
    if (base.profiles || extra.profiles) {
        document.profiles = mergeMaps(base.profiles, extra.profiles);
    }
    if (base.namespace || extra.namespace) {
        document.namespace = mergeNodes(base.namespace, extra.namespace);
    }
    return document;
}
