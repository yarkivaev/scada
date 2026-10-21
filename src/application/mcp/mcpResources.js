/**
 * Parent path of a node, or an empty string at the root.
 *
 * @param {string} path - namespace path
 * @returns {string} parent path
 *
 * @example
 *   parentOf('site/shop');
 */
function parentOf(path) {
    const cut = path.lastIndexOf('/');
    if (cut < 0) {
        return '';
    }
    return path.slice(0, cut);
}

/**
 * Topology resource body without source topics.
 *
 * @param {object} tree - namespaceTree
 * @returns {Array<object>} nodes
 *
 * @example
 *   topology(tree);
 */
function topology(tree) {
    return tree.list().map((node) => {
        return {
            kind: node.kind,
            liveness: node.silenceSeconds,
            parent: parentOf(node.path),
            path: node.path,
            title: node.title
        };
    });
}

/**
 * Binding resource body: path, source topic, and unit.
 *
 * @param {object} tree - namespaceTree
 * @returns {Array<object>} bindings
 *
 * @example
 *   bindings(tree);
 */
function bindings(tree) {
    return tree.list().filter((node) => {
        return typeof node.source === 'string';
    }).map((node) => {
        return {
            path: node.path,
            topic: node.source,
            unit: typeof node.unit === 'string' ? node.unit : ''
        };
    });
}

/**
 * JSON resource contents for one URI.
 *
 * @param {string} uri - resource URI
 * @param {object} payload - JSON body
 * @returns {object} read result
 *
 * @example
 *   body('plant://topology', []);
 */
function body(uri, payload) {
    return {
        contents: [{
            mimeType: 'application/json',
            text: JSON.stringify(payload),
            uri
        }]
    };
}

/**
 * Registers plant topology and source bindings.
 *
 * Topology has paths, kinds, titles, and liveness. Bindings map a path to a
 * topic and a unit. Gateway topics are not part of topology.
 *
 * @param {object} server - McpServer
 * @param {object} tree - namespaceTree
 * @returns {void}
 *
 * @example
 *   registerResources(server, tree);
 */
export default function registerResources(server, tree) {
    server.registerResource('topology', 'plant://topology', {
        description: 'Paths, kinds, titles, and liveness',
        mimeType: 'application/json'
    }, () => {
        return body('plant://topology', topology(tree));
    });
    server.registerResource('bindings', 'plant://bindings', {
        description: 'Source topic and unit for each bound path',
        mimeType: 'application/json'
    }, () => {
        return body('plant://bindings', bindings(tree));
    });
}
