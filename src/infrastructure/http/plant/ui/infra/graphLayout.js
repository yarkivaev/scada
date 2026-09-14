function shops(nodes) {
    return nodes.filter((node) => {
        return node.kind === 'shop';
    });
}

function children(nodes, parentId, kind) {
    return nodes.filter((node) => {
        return node.parent === parentId && node.kind === kind;
    });
}

function nest(nodes, item, x, y, placed) {
    children(nodes, item.id, 'collector').forEach((col, k) => {
        placed[col.id] = { x: x + 96, y: y + k * 26 };
    });
}

function machines(nodes, area, x, base, placed) {
    children(nodes, area.id, 'machine').forEach((item, j) => {
        const y = base + j * 96;
        placed[item.id] = { x, y };
        nest(nodes, item, x, y, placed);
    });
}

function extras(nodes, area, x, placed) {
    const items = children(nodes, area.id, 'collector');
    items.forEach((col, k) => {
        placed[col.id] = { x, y: 108 + k * 28 };
    });
    return items.length;
}

function column(area, index, nodes, placed) {
    const x = 170 + index * 280;
    placed[area.id] = { x, y: 56 };
    const count = extras(nodes, area, x, placed);
    const base = count === 0 ? 150 : 108 + count * 28 + 50;
    machines(nodes, area, x, base, placed);
}

function leftovers(nodes, placed) {
    nodes.filter((node) => {
        return node.kind === 'collector' && !placed[node.id];
    }).forEach((node, i) => {
        placed[node.id] = { x: 72, y: 88 + i * 54 };
    });
}

/**
 * Column positions for topology nodes by parent and kind.
 *
 * @param {object} graph - topology contract { nodes }
 * @returns {object} id -> { x, y }
 *
 * @example
 *   positions({ nodes: [{ id: 'area-1', kind: 'shop' }] })['area-1'].x === 170;
 */
export default function positions(graph) {
    const nodes = graph.nodes || [];
    const placed = {};
    shops(nodes).forEach((area, i) => {
        column(area, i, nodes, placed);
    });
    leftovers(nodes, placed);
    return placed;
}
