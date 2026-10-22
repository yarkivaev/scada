import { clickhouseSchema, postgresSchema } from './mcpSchema.js';

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
 * Enumerates catalog entries without knowing their vocabulary.
 *
 * @param {object} [catalog] - tagCatalog with entries()
 * @returns {Array<object>} entries
 *
 * @example
 *   tags({ entries() { return []; } });
 */
function tags(catalog) {
    if (catalog && typeof catalog.entries === 'function') {
        return catalog.entries();
    }
    return [];
}

/**
 * Registers one JSON resource.
 *
 * @param {object} server - McpServer
 * @param {string} name - resource name
 * @param {string} uri - resource URI
 * @param {string} description - short list description
 * @param {Function} payload - body factory
 * @returns {void}
 *
 * @example
 *   publish(server, 'topology', 'plant://topology', 'Paths', () => []);
 */
function publish(server, name, uri, description, payload) {
    server.registerResource(name, uri, {
        description,
        mimeType: 'application/json'
    }, () => {
        return body(uri, payload());
    });
}

/**
 * Registers plant topology, bindings, tags, and storage schemas.
 *
 * Topology has paths, kinds, titles, and liveness. Bindings map a path to a
 * topic and a unit. Tags enumerate the catalog the plant package supplied.
 * Schema resources list scada migration tables. Gateway topics stay out of
 * topology. Operators omit card_uid. kind is opaque.
 *
 * @param {object} server - McpServer
 * @param {object} tree - namespaceTree
 * @param {object} [catalog] - tagCatalog with entries()
 * @returns {void}
 *
 * @example
 *   registerResources(server, tree, catalog);
 */
export default function registerResources(server, tree, catalog) {
    publish(server, 'topology', 'plant://topology', 'Paths, kinds, titles, and liveness', () => {
        return topology(tree);
    });
    publish(server, 'bindings', 'plant://bindings', 'Source topic and unit for each bound path', () => {
        return bindings(tree);
    });
    publish(server, 'tags', 'plant://tags', 'Tag catalog entries from the plant package', () => {
        return tags(catalog);
    });
    publish(server, 'schema-postgres', 'plant://schema/postgres', 'Postgres tables from scada migrations', postgresSchema);
    publish(server, 'schema-clickhouse', 'plant://schema/clickhouse', 'ClickHouse scada.metrics', clickhouseSchema);
}
