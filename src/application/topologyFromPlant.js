/**
 * Builds the plant topology JSON contract.
 * An explicit plant.topology() function wins; otherwise the shop/machine/sensor tree is walked.
 *
 * @param {object} plant - plant with shops and optional topology()
 * @returns {object} { plant, nodes, links }
 *
 * @example
 *   topologyFromPlant(plant);
 */
function assertGraph(graph) {
    if (!graph || typeof graph !== 'object') {
        throw new Error(`topology graph is missing: ${graph}`);
    }
    if (!graph.plant || typeof graph.plant.id !== 'string' || typeof graph.plant.title !== 'string') {
        throw new Error(`topology plant id and title are required: ${JSON.stringify(graph.plant)}`);
    }
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
        throw new Error('topology nodes and links arrays are required');
    }
    graph.nodes.forEach((node) => {
        if (typeof node.id !== 'string' || typeof node.kind !== 'string' || typeof node.title !== 'string') {
            throw new Error(`topology node requires id, kind, title: ${JSON.stringify(node)}`);
        }
    });
    graph.links.forEach((link) => {
        if (typeof link.from !== 'string' || typeof link.to !== 'string' || typeof link.kind !== 'string') {
            throw new Error(`topology link requires from, to, kind: ${JSON.stringify(link)}`);
        }
    });
    return graph;
}

function collectors(machineId, item) {
    const nodes = [];
    const links = [];
    Object.keys(item.sensors || {}).forEach((key) => {
        nodes.push({
            id: `${machineId}-${key}`,
            kind: 'collector',
            title: key,
            parent: machineId,
            status: 'unknown'
        });
        links.push({ from: machineId, to: `${machineId}-${key}`, kind: 'contains' });
    });
    return { nodes, links };
}

function shopGraph(shopId, area) {
    const nodes = [{ id: shopId, kind: 'shop', title: area.name(), status: 'unknown' }];
    const links = [];
    Object.entries(area.machines.get()).forEach(([machineId, item]) => {
        nodes.push({
            id: machineId,
            kind: 'machine',
            title: item.name(),
            parent: shopId,
            status: 'unknown'
        });
        links.push({ from: shopId, to: machineId, kind: 'contains' });
        const nested = collectors(machineId, item);
        nodes.push(...nested.nodes);
        links.push(...nested.links);
    });
    return { nodes, links };
}

function walkGraph(plant) {
    const nodes = [];
    const links = [];
    Object.entries(plant.shops.get()).forEach(([shopId, area]) => {
        const piece = shopGraph(shopId, area);
        nodes.push(...piece.nodes);
        links.push(...piece.links);
    });
    return { plant: { id: 'plant', title: 'plant' }, nodes, links };
}

export default function topologyFromPlant(plant) {
    if (typeof plant.topology === 'function') {
        return assertGraph(plant.topology());
    }
    return walkGraph(plant);
}
