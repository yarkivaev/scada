import { nodeById } from './releaseNodes.js';
import { serviceUrl } from './releaseEdges.js';

/**
 * Maps one module name onto a chart product.
 *
 * @param {string} name - module name
 * @param {object} spec - module spec
 * @param {string|undefined} secret - state-store Secret name
 * @returns {[string, object]} chart key and values
 * @example
 *   bindOne('telemetry_store', { enabled: true });
 */
function bindOne(name, spec, secret) {
    if (name === 'state_store') {
        return ['postgres', { enabled: spec.enabled !== false, secret: secret || 'scada-postgres' }];
    }
    if (name === 'message_bus') {
        return ['rabbitmq', { enabled: spec.enabled !== false }];
    }
    if (name === 'telemetry_store') {
        return ['clickhouse', { enabled: spec.enabled !== false }];
    }
    throw new Error(`system document has no module ${name}`);
}

/**
 * Maps enabled modules onto chart product keys.
 *
 * @param {object} profile - node profile
 * @param {string|undefined} secret - state-store Secret name
 * @returns {object} postgres, rabbitmq, and clickhouse fragments
 * @example
 *   bindModules({ modules: { telemetry_store: { enabled: true } } }, 'pg');
 */
export function bindModules(profile, secret) {
    const values = {};
    Object.keys(profile.modules || {}).forEach((name) => {
        const [key, value] = bindOne(name, profile.modules[name], secret);
        values[key] = value;
    });
    return values;
}

/**
 * Routes aimed at one node.
 *
 * @param {object} document - system document
 * @param {object[]} edges - directed edges
 * @param {object} node - receiver
 * @returns {object[]} EDGE_SITES entries
 * @example
 *   routesFor(document, edges, node);
 */
export function routesFor(document, edges, node) {
    const routes = [];
    edges.filter((edge) => {return edge.to === node.id}).forEach((edge) => {
        const source = nodeById(document, edge.from);
        if (!edge.api && (source.api || []).length === 0) {
            return;
        }
        routes.push({
            baseUrl: serviceUrl(source, edge.api),
            machines: edge.objects.slice()
        });
    });
    return routes;
}

/**
 * Telemetry this node receives from a source that is not a node.
 *
 * @param {object} document - system document
 * @param {object} node - selected node
 * @returns {object[]} device records named by those flows
 * @example
 *   telemetryOf(document, node);
 */
export function telemetryOf(document, node) {
    const ids = new Set((document.nodes || []).map((item) => {return item.id}));
    const catalog = node.objects || [];
    return (node.fan_in || []).filter((entry) => {
        return entry && entry.from && !ids.has(entry.from);
    }).map((flow) => {
        const found = catalog.find((item) => {return item.id === flow.object});
        return found || flow;
    });
}

/**
 * Apps other than scada whose clusters include this release.
 *
 * @param {object} document - system document
 * @param {string} cluster - release selector
 * @returns {object[]} pass-through apps
 * @example
 *   passedApps(document, 'archive');
 */
export function passedApps(document, cluster) {
    return Object.keys(document.apps || {}).filter((name) => {return name !== 'scada'}).filter((name) => {
        const app = document.apps[name];
        return (app.clusters || []).includes(cluster);
    }).map((name) => {
        const app = document.apps[name];
        if (!app.chart) {
            throw new Error(`system document app ${name} has no chart`);
        }
        return { chart: app.chart, name, values: app.values };
    });
}
