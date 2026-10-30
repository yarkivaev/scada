/**
 * Finds the node installed into one cluster.
 *
 * @param {object} document - system document
 * @param {string} cluster - release selector
 * @returns {object} node
 * @example
 *   nodeFor({ nodes: [] }, 'missing');
 */
export function nodeFor(document, cluster) {
    const found = (document.nodes || []).find((node) => {
        return node.implementation && node.implementation.cluster === cluster;
    });
    if (!found) {
        throw new Error(`system document has no node for cluster ${cluster}`);
    }
    return found;
}

/**
 * Finds a node by id.
 *
 * @param {object} document - system document
 * @param {string} id - node id
 * @returns {object} node
 * @example
 *   nodeById(document, 'cell');
 */
export function nodeById(document, id) {
    const found = (document.nodes || []).find((node) => {return node.id === id});
    if (!found) {
        throw new Error(`system document has no node ${id}`);
    }
    return found;
}

/**
 * Finds one machine record.
 *
 * @param {object} document - system document
 * @param {string} id - object id
 * @returns {object} machine
 * @example
 *   machineById(document, 'unit-1');
 */
export function machineById(document, id) {
    const found = (document.machines || []).find((item) => {return item.id === id});
    if (!found) {
        throw new Error(`system document has no object ${id}`);
    }
    return found;
}

/**
 * Loads the profile a node names.
 *
 * @param {object} document - system document
 * @param {object} node - selected node
 * @returns {object} profile
 * @example
 *   profileFor(document, node);
 */
export function profileFor(document, node) {
    const name = node.implementation && node.implementation.profile;
    const profile = document.profiles && name ? document.profiles[name] : undefined;
    if (!profile) {
        throw new Error(`system document has no profile ${name}`);
    }
    return profile;
}
