import { nodeById } from './releaseNodes.js';

/**
 * Compares two object lists without regard to order.
 *
 * @param {string[]} left - one side
 * @param {string[]} right - the other side
 * @returns {boolean} whether the lists name the same objects
 * @example
 *   sameObjects(['a'], ['a']);
 */
function sameObjects(left, right) {
    const first = left.slice().sort();
    const second = right.slice().sort();
    return first.length === second.length && first.every((item, index) => {return item === second[index]});
}

/**
 * Records one directed edge, rejecting a disagreeing second side.
 *
 * @param {object[]} edges - accumulated edges
 * @param {{from: string, to: string, objects: string[], api: string|undefined}} edge - one side
 * @returns {void}
 * @example
 *   remember(edges, { from: 'cell', to: 'archive', objects: ['unit-1'], api: undefined });
 */
function remember(edges, edge) {
    const found = edges.find((item) => {return item.from === edge.from && item.to === edge.to});
    if (!found) {
        edges.push({
            api: edge.api,
            from: edge.from,
            objects: edge.objects.slice(),
            to: edge.to
        });
        return;
    }
    if (!sameObjects(found.objects, edge.objects)) {
        throw new Error(`system document edge from ${edge.from} to ${edge.to} lists different objects`);
    }
    if (edge.api) {
        found.api = edge.api;
    }
}

/**
 * Collects upstream and fan-in as one edge list.
 *
 * @param {object} document - system document
 * @returns {object[]} directed edges
 * @example
 *   edgesOf(document);
 */
export function edgesOf(document) {
    const edges = [];
    (document.nodes || []).forEach((node) => {
        (node.upstream || []).forEach((edge) => {
            nodeById(document, edge.to);
            remember(edges, { api: undefined, from: node.id, objects: edge.objects || [], to: edge.to });
        });
        (node.fan_in || []).forEach((edge) => {
            nodeById(document, edge.from);
            remember(edges, { api: edge.api, from: edge.from, objects: edge.objects || [], to: node.id });
        });
    });
    return edges;
}

/**
 * Reports whether a node owns an object or receives it from someone who holds it.
 *
 * @param {object} document - system document
 * @param {object[]} edges - directed edges
 * @param {string} nodeId - candidate holder
 * @param {string} objectId - object id
 * @param {string[]} stack - nodes already visited for this object
 * @returns {boolean} whether the node holds the object
 * @example
 *   holds(document, edges, 'cell', 'unit-1', []);
 */
function holds(document, edges, nodeId, objectId, stack) {
    const node = nodeById(document, nodeId);
    if ((node.ownership || []).includes(objectId)) {
        return true;
    }
    if (stack.includes(nodeId)) {
        throw new Error(`system document cycles ${objectId} at ${nodeId}`);
    }
    const incoming = edges.filter((edge) => {return edge.to === nodeId && edge.objects.includes(objectId)});
    const next = stack.concat(nodeId);
    return incoming.some((edge) => {return holds(document, edges, edge.from, objectId, next)});
}

/**
 * Rejects an edge whose source does not hold every listed object.
 *
 * @param {object} document - system document
 * @param {object[]} edges - directed edges
 * @returns {void}
 * @example
 *   assertHeld(document, edges);
 */
export function assertHeld(document, edges) {
    edges.forEach((edge) => {
        edge.objects.forEach((objectId) => {
            const held = holds(document, edges, edge.from, objectId, []);
            if (!held) {
                throw new Error(`system document node ${edge.from} does not hold ${objectId}`);
            }
        });
    });
}

/**
 * URL of one service on a source node.
 *
 * @param {object} node - source node
 * @param {string|undefined} api - service id, when the edge names one
 * @returns {string} service URL
 * @example
 *   serviceUrl(node, 'plant');
 */
export function serviceUrl(node, api) {
    const services = node.api || [];
    const found = api ? services.find((item) => {return item.id === api}) : undefined;
    if (api && !found) {
        throw new Error(`system document node ${node.id} provides no api ${api}`);
    }
    if (found) {
        return found.url;
    }
    if (services.length !== 1) {
        throw new Error(`system document node ${node.id} must name one api`);
    }
    return services[0].url;
}
