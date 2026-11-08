import { expandTree, treePaths } from './expandNamespace.js';
import { expandProfiles } from './expandProfiles.js';
import { expandServers } from './expandFlows.js';
import frozen from './frozen.js';

/**
 * Rejects a server whose profile is missing.
 *
 * @param {object[]} servers - declared servers
 * @param {object} profiles - resolved profiles
 * @returns {void}
 * @example
 *   assertProfiles([], {});
 */
function assertProfiles(servers, profiles) {
    servers.forEach((server) => {
        const label = server.profile && server.profile.id;
        if (!label || !profiles[label]) {
            throw new Error(`system document has no profile ${label}`);
        }
    });
}

/**
 * Expands templates, mappings, patterns, and profile `extends`.
 *
 * The result is a concrete document. It does not install a cluster.
 *
 * @param {object} document - system document
 * @returns {object} expanded document
 * @example
 *   expand({ namespace: [{ id: 'mill' }], profiles: {}, servers: [] });
 */
export default function expand(document) {
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
        throw new Error('system document is empty');
    }
    const namespace = expandTree(document.namespace, document.templates || {});
    const paths = treePaths(namespace);
    const profiles = expandProfiles(document.profiles || {});
    assertProfiles(document.servers || [], profiles);
    const servers = expandServers(document.servers || [], paths, document.mappings || {});
    return frozen({
        ...(document.hmi !== undefined && { hmi: document.hmi }),
        mappings: document.mappings || {},
        namespace,
        profiles,
        servers
    });
}
