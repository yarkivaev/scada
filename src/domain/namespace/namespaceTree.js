/**
 * Reads a non-empty path.
 *
 * @param {object} node - candidate node
 * @returns {string} path
 *
 * @example
 *   pathOf({ path: 'site/unit' });
 */
function pathOf(node) {
    if (typeof node.path === 'string' && node.path.length > 0) {
        return node.path;
    }
    throw new Error('Namespace path is empty');
}

/**
 * Requires a non-empty opaque kind.
 *
 * @param {object} node - candidate node
 * @returns {string} kind
 *
 * @example
 *   kindOf({ kind: 'metric', path: 'site/metric' });
 */
function kindOf(node) {
    if (typeof node.kind === 'string' && node.kind.length > 0) {
        return node.kind;
    }
    throw new Error(`Namespace kind is missing for ${pathOf(node)}`);
}

/**
 * Requires a non-negative silence threshold in seconds.
 *
 * @param {object} node - candidate node
 * @returns {number} silence seconds
 *
 * @example
 *   silenceOf({ path: 'site', silenceSeconds: 60 });
 */
function silenceOf(node) {
    const value = node.silenceSeconds;
    if (typeof value === 'number' && value >= 0) {
        return value;
    }
    throw new Error(`Namespace silence is missing for ${pathOf(node)}`);
}

/**
 * Uses an explicit title or the last path segment.
 *
 * @param {object} node - candidate node
 * @param {string} path - unique path
 * @returns {string} display title
 *
 * @example
 *   titled({ title: 'Unit' }, 'site/unit');
 */
function titled(node, path) {
    if (typeof node.title === 'string' && node.title.length > 0) {
        return node.title;
    }
    const parts = path.split('/');
    return parts[parts.length - 1];
}

/**
 * Copies one node into a frozen record.
 *
 * @param {object} node - candidate node
 * @param {string} path - unique path
 * @returns {object} frozen node
 *
 * @example
 *   freezeNode({ kind: 'site', path: 'site', silenceSeconds: 30 }, 'site');
 */
function freezeNode(node, path) {
    const frozen = {
        kind: kindOf(node),
        path,
        silenceSeconds: silenceOf(node),
        title: titled(node, path)
    };
    if (typeof node.source === 'string') {
        frozen.source = node.source;
    }
    if (typeof node.unit === 'string') {
        frozen.unit = node.unit;
    }
    return Object.freeze(frozen);
}

/**
 * Builds a path map and rejects duplicates.
 *
 * @param {Array<object>} nodes - candidate nodes
 * @returns {{ list: Array<object>, map: Map<string, object> }} index
 *
 * @example
 *   indexNodes([{ kind: 'site', path: 'site', silenceSeconds: 30 }]);
 */
function indexNodes(nodes) {
    const map = new Map();
    for (const node of nodes) {
        const path = pathOf(node);
        if (map.has(path)) {
            throw new Error(`Namespace path is duplicated: ${path}`);
        }
        map.set(path, freezeNode(node, path));
    }
    return { list: [...map.values()], map };
}

/**
 * Returns the node for a path or throws when it is absent.
 *
 * @param {Map<string, object>} map - path index
 * @param {string} path - requested path
 * @returns {object} frozen node
 *
 * @example
 *   lookup(new Map([['site', { path: 'site' }]]), 'site');
 */
function lookup(map, path) {
    const node = map.get(path);
    if (node) {
        return node;
    }
    throw new Error(`Namespace path is missing: ${path}`);
}

/**
 * Requires an array of nodes.
 *
 * @param {Array<object>} nodes - candidate nodes
 * @returns {Array<object>} the same array when it is an array
 *
 * @example
 *   nodesOf([{ kind: 'site', path: 'site', silenceSeconds: 30 }]);
 */
function nodesOf(nodes) {
    if (Array.isArray(nodes)) {
        return nodes;
    }
    throw new Error('Namespace nodes are missing');
}

/**
 * Indexes plant nodes by a unique path for analytics reads.
 *
 * A node is an opaque kind, a silence threshold in seconds, and an optional
 * source topic. Paths are the address. Gateway topics stay on the node and
 * are not required.
 *
 * @param {Array<object>} nodes - path, kind, silenceSeconds, optional source, title, unit
 * @returns {object} list, resolve, and below
 *
 * @example
 *   const tree = namespaceTree([
 *     { path: 'site/shop/unit', kind: 'unit', silenceSeconds: 60 }
 *   ]);
 *   tree.resolve('site/shop/unit').kind;
 */
export default function namespaceTree(nodes) {
    const index = indexNodes(nodesOf(nodes));
    return Object.freeze({
        below(path) {
            const node = lookup(index.map, path);
            const prefix = `${node.path}/`;
            return index.list.filter((item) => {
                return item.path.startsWith(prefix);
            });
        },
        list() {
            return index.list.slice();
        },
        resolve(path) {
            return lookup(index.map, path);
        }
    });
}
