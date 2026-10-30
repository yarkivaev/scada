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
    return edges.filter((edge) => {return edge.to === node.id}).map((edge) => {
        return {
            baseUrl: serviceUrl(nodeById(document, edge.from), edge.api),
            machines: edge.objects.slice()
        };
    });
}

/**
 * Telemetry this node receives from a device. Entries with `from` are routes.
 *
 * @param {object} node - selected node
 * @returns {object[]} fan-in records
 * @example
 *   telemetryOf(node);
 */
export function telemetryOf(node) {
    return (node.fan_in || []).filter((entry) => {
        return entry && typeof entry !== 'string' && !entry.from;
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
