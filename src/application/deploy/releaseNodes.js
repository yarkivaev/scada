import { mergeMaps } from './mergeDocuments.js';

/**
 * Reads an object entry as a path.
 *
 * @param {string|object} entry - object path or record
 * @returns {string} path
 * @example
 *   asPath('mill/unit');
 */
export function asPath(entry) {
    if (typeof entry === 'string' && entry.length > 0) {
        return entry;
    }
    if (entry && typeof entry.id === 'string' && entry.id.length > 0) {
        return entry.id;
    }
    throw new Error('system document object path is empty');
}

/**
 * Finds the server object path that a flow name extends.
 *
 * @param {object} server - source server
 * @param {string} name - flow name
 * @returns {string} object path, or the flow name when none is declared
 * @example
 *   objectPath({ objects: ['mill/unit'] }, 'mill/unit/electrical');
 */
export function objectPath(server, name) {
    const paths = (server.objects || []).map((entry) => {
        return asPath(entry);
    });
    const found = paths.filter((path) => {
        return name === path || name.startsWith(`${path}/`);
    });
    found.sort((left, right) => {
        return right.length - left.length;
    });
    return found[0] || name;
}

/**
 * Finds a server by id.
 *
 * @param {object} document - expanded document
 * @param {string} id - server id
 * @returns {object} server
 * @example
 *   serverById({ servers: [{ id: 'cell' }] }, 'cell');
 */
export function serverById(document, id) {
    const found = (document.servers || []).find((server) => {
        return server.id === id;
    });
    if (!found) {
        throw new Error(`system document has no server ${id}`);
    }
    return found;
}

/**
 * Reads the cluster a server selects.
 *
 * @param {object} document - expanded document
 * @param {object} server - selected server
 * @returns {string|null|undefined} cluster
 * @example
 *   clusterOf({ profiles: { cell: {} } }, { profile: { id: 'cell', variables: { cluster: 'cell' } } });
 */
export function clusterOf(document, server) {
    const label = server.profile && server.profile.id;
    const profile = document.profiles && document.profiles[label];
    if (!profile) {
        throw new Error(`system document has no profile ${label}`);
    }
    const values = { ...(profile.variables || {}), ...(server.profile.variables || {}) };
    return values.cluster;
}

/**
 * Finds the one server installed into a cluster.
 *
 * @param {object} document - expanded document
 * @param {string} cluster - release selector
 * @returns {object} server
 * @example
 *   serverFor({ profiles: {}, servers: [] }, 'missing');
 */
export function serverFor(document, cluster) {
    const found = (document.servers || []).filter((server) => {
        return clusterOf(document, server) === cluster;
    });
    if (found.length === 0) {
        throw new Error(`system document has no server for cluster ${cluster}`);
    }
    if (found.length > 1) {
        throw new Error(`system document has several servers for cluster ${cluster}`);
    }
    return found[0];
}

/**
 * Loads the profile a server names, with server variables overlaid.
 *
 * @param {object} document - expanded document
 * @param {object} server - selected server
 * @returns {object} profile
 * @example
 *   profileFor({ profiles: { cell: {} } }, { profile: { id: 'cell' } });
 */
export function profileFor(document, server) {
    const label = server.profile && server.profile.id;
    const profile = document.profiles && document.profiles[label];
    if (!profile) {
        throw new Error(`system document has no profile ${label}`);
    }
    const values = { ...(profile.variables || {}), ...(server.profile.variables || {}) };
    return { ...profile, ...(server.modules && { modules: mergeMaps(profile.modules, server.modules) }), variables: values };
}

/** Selects an explicitly named service or the sole service of the source. */
export function serviceOf(source, api) {
    const listed = source.api || [];
    if (!api && listed.length > 1) {
        throw new Error(`system document server ${source.id} must name one api`);
    }
    const service = api ? listed.find((item) => { return item.id === api; }) : listed[0];
    if (api && !service) {
        throw new Error(`system document server ${source.id} provides no api ${api}`);
    }
    return service;
}
