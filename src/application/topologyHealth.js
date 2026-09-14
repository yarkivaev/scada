/**
 * Paints topology node status from live sensor current() readings.
 * Does not read kube or Prometheus. Unmatched nodes keep their existing status.
 *
 * @param {object} graph - topology contract { plant, nodes, links }
 * @param {object} plant - plant with shops().get() machines and sensors
 * @param {function} [clock] - () => Date
 * @returns {Promise<object>} graph with status overlays
 *
 * @example
 *   await topologyHealth(graph, plant, () => new Date());
 */
function age(reading, now) {
    if (!reading || reading.found !== true || !reading.timestamp) {
        return Number.POSITIVE_INFINITY;
    }
    return now.getTime() - new Date(reading.timestamp).getTime();
}

function grade(ms) {
    if (!Number.isFinite(ms)) {
        return 'down';
    }
    if (ms <= 300000) {
        return 'ok';
    }
    if (ms <= 1800000) {
        return 'degraded';
    }
    return 'down';
}

function rollup(states) {
    if (states.length === 0) {
        return undefined;
    }
    if (states.every((item) => {
        return item === 'ok';
    })) {
        return 'ok';
    }
    if (states.every((item) => {
        return item === 'down';
    })) {
        return 'down';
    }
    return 'degraded';
}

async function sample(id, item, now) {
    try {
        return [id, grade(age(await item.current(), now))];
    } catch {
        return [id, 'down'];
    }
}

async function probeMachine(machineId, item, now) {
    const keys = Object.keys(item.sensors || {});
    const pairs = await Promise.all(keys.map((key) => {
        return sample(`${machineId}-${key}`, item.sensors[key], now);
    }));
    const status = rollup(pairs.map((pair) => {
        return pair[1];
    }));
    if (status) {
        pairs.push([machineId, status]);
    }
    return pairs;
}

function machineMarks(pairs, machineIds) {
    return machineIds.map((machineId) => {
        const hit = pairs.find((pair) => {
            return pair[0] === machineId;
        });
        return hit ? hit[1] : undefined;
    }).filter(Boolean);
}

async function probeShop(shopId, area, now) {
    const machines = area.machines.get();
    const chunks = await Promise.all(Object.entries(machines).map(([machineId, item]) => {
        return probeMachine(machineId, item, now);
    }));
    const pairs = chunks.flat();
    const status = rollup(machineMarks(pairs, Object.keys(machines)));
    if (status) {
        pairs.push([shopId, status]);
    }
    return pairs;
}

function statusOf(node, marks) {
    if (marks.has(node.id)) {
        return marks.get(node.id);
    }
    if (node.kind === 'collector' && node.parent && marks.has(node.parent)) {
        return marks.get(node.parent);
    }
    return undefined;
}

function paint(graph, marks) {
    return {
        plant: graph.plant,
        links: graph.links,
        nodes: graph.nodes.map((node) => {
            const status = statusOf(node, marks);
            if (!status) {
                return node;
            }
            return { ...node, status };
        })
    };
}

export default async function topologyHealth(graph, plant, clock) {
    if (!plant.shops || typeof plant.shops.get !== 'function') {
        return graph;
    }
    const now = clock ? clock() : new Date();
    const shops = plant.shops.get();
    const chunks = await Promise.all(Object.entries(shops).map(([shopId, area]) => {
        return probeShop(shopId, area, now);
    }));
    return paint(graph, new Map(chunks.flat()));
}
