import { isAddress } from './expandPattern.js';
import { clusterOf, objectPath, serverById, serviceOf } from './releaseNodes.js';

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
        return ['postgres', { ...spec.chart, ...(spec.pgdata !== undefined && { data: spec.pgdata }),
            enabled: spec.enabled !== false, secret: secret || 'scada-postgres' }];
    }
    if (name === 'message_bus') {
        return ['rabbitmq', { ...spec.chart, enabled: spec.enabled !== false,
            ...(spec.dead_letter ? { deadLetter: spec.dead_letter } : {}) }];
    }
    if (name === 'telemetry_store') {
        return ['clickhouse', { enabled: spec.enabled !== false }];
    }
    if (name === 'mdmesh') {
        return ['mdmesh', { ...spec.chart, ...(spec.namespace !== undefined && { namespace: spec.namespace }),
            enabled: spec.enabled !== false }];
    }
    throw new Error(`system document has no module ${name}`);
}

/**
 * Maps modules onto chart product keys.
 *
 * @param {object} profile - server profile
 * @param {string|undefined} secret - state-store Secret name
 * @returns {object} postgres, rabbitmq, clickhouse, and mdmesh fragments
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
 * Opaque fields of an object record.
 *
 * @param {object} server - selected server
 * @param {string} path - object path
 * @returns {object} extra fields
 * @example
 *   recordFor({ objects: ['mill/unit'] }, 'mill/unit');
 */
function recordFor(server, path) {
    const found = (server.objects || []).find((entry) => {
        return typeof entry === 'object' && entry !== null && (entry.id === path || entry.path === path);
    });
    return found || {};
}

/**
 * Local fan-in joined with the server's objects.
 *
 * @param {object} server - selected server
 * @returns {object[]} machine records
 * @example
 *   machinesOf({ fan_in: [], id: 'cell' });
 */
export function machinesOf(server) {
    const rows = [];
    (server.fan_in || []).forEach((flow) => {
        if (!isAddress(flow.from)) {
            return;
        }
        const path = objectPath(server, flow.name);
        const row = {
            from: flow.from,
            id: path.split('/').at(-1),
            name: flow.name
        };
        if (flow.mapping) {
            row.mapping = flow.mapping;
        }
        const extra = recordFor(server, path);
        Object.keys(extra).forEach((key) => {
            if (key !== 'id' && key !== 'path') {
                row[key] = extra[key];
            }
        });
        rows.push(row);
    });
    return rows;
}

/**
 * Plant API URL of a source, when that source publishes one.
 *
 * @param {object} source - source server
 * @param {string|undefined} api - service the edge names
 * @returns {string} plant URL, or empty when the source publishes none
 * @example
 *   plantUrl({ api: [{ id: 'plant', url: 'http://192.0.2.10/api/v1' }], id: 'cell' });
 */
function plantUrl(source, api) {
    const service = serviceOf(source, api);
    return service?.id === 'plant' ? service.url : '';
}

/**
 * Sites for edges aimed at one server.
 *
 * `baseUrl` is the source plant API. A source with no plant API is skipped.
 *
 * @param {object} document - expanded document
 * @param {object[]} edges - directed edges
 * @param {object} server - receiver
 * @returns {object[]} site entries
 * @example
 *   routesFor({ servers: [] }, [], { id: 'archive' });
 */
export function routesFor(document, edges, server) {
    const routes = [];
    edges.filter((edge) => {
        return edge.to === server.id;
    }).forEach((edge) => {
        const source = serverById(document, edge.from);
        const url = plantUrl(source, edge.api);
        if (url.length === 0) {
            return;
        }
        const machines = [];
        edge.objects.forEach((path) => {
            const id = path.split('/').at(-1);
            if (!machines.includes(id)) {
                machines.push(id);
            }
        });
        routes.push({ baseUrl: url, machines });
    });
    return routes;
}

/**
 * Bus bindings a fan-out opens on another cluster.
 *
 * @param {object} document - expanded document
 * @param {object} server - sender
 * @returns {{names: string[], url: string}[]} bus bindings
 * @example
 *   busesFor({ profiles: {}, servers: [] }, { fan_out: [], profile: { id: 'cell' } });
 */
export function busesFor(document, server) {
    const mine = clusterOf(document, server);
    const groups = new Map();
    (server.fan_out || []).forEach((flow) => {
        const dest = serverById(document, flow.to);
        const other = clusterOf(document, dest);
        if (other === mine) {
            return;
        }
        if (!groups.has(other)) {
            const bus = (dest.api || []).find((item) => {
                return item.id === 'bus';
            });
            if (!bus) {
                throw new Error(`system document server ${dest.id} provides no api bus`);
            }
            groups.set(other, { names: [], url: bus.url });
        }
        groups.get(other).names.push(flow.name);
    });
    return Array.from(groups.values());
}

/**
 * Apps of a profile other than scada.
 *
 * @param {object} profile - resolved profile
 * @returns {object[]} pass-through apps
 * @example
 *   passedApps({ apps: { frontend: { image: 'example.invalid/hmi:1' } } });
 */
export function passedApps(profile) {
    return Object.keys(profile.apps || {}).filter((name) => {
        return name !== 'scada';
    }).map((name) => {
        return { ...profile.apps[name], name };
    });
}
