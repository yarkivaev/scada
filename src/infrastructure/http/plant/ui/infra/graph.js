const SVG = 'http://www.w3.org/2000/svg';

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

function placed(graph) {
    const positions = {};
    shops(graph.nodes).forEach((area, i) => {
        const x = 170 + i * 280;
        positions[area.id] = { x, y: 56 };
        children(graph.nodes, area.id, 'machine').forEach((item, j) => {
            const y = 150 + j * 96;
            positions[item.id] = { x, y };
            children(graph.nodes, item.id, 'collector').forEach((col, k) => {
                positions[col.id] = { x: x + 96, y: y + k * 26 };
            });
        });
    });
    graph.nodes.filter((node) => {
        return node.kind === 'collector' && !positions[node.id];
    }).forEach((node, i) => {
        positions[node.id] = { x: 72, y: 88 + i * 54 };
    });
    return positions;
}

function el(name, attrs) {
    const node = document.createElementNS(SVG, name);
    Object.entries(attrs).forEach(([key, value]) => {
        node.setAttribute(key, String(value));
    });
    return node;
}

function paintLink(svg, graph, positions) {
    graph.links.forEach((link) => {
        const from = positions[link.from];
        const to = positions[link.to];
        if (!from || !to) {
            return;
        }
        const line = el('path', { class: `link link--${link.kind}` });
        line.setAttribute('d', `M ${from.x} ${from.y} C ${from.x} ${(from.y + to.y) / 2}, ${to.x} ${(from.y + to.y) / 2}, ${to.x} ${to.y}`);
        svg.appendChild(line);
    });
}

function paintShape(node, pos) {
    if (node.kind === 'machine') {
        return el('rect', { class: 'node__shape', x: pos.x - 42, y: pos.y - 18, width: 84, height: 36, rx: 4 });
    }
    const radius = node.kind === 'shop' ? 22 : 10;
    return el('circle', { class: 'node__shape', cx: pos.x, cy: pos.y, r: radius });
}

function paintNode(svg, node, pos, onClick) {
    const group = el('g', { class: `node node--${node.status || 'unknown'}`, 'data-id': node.id });
    const label = el('text', { class: 'node__label', x: pos.x, y: pos.y + 36, 'text-anchor': 'middle' });
    label.textContent = node.title;
    group.appendChild(paintShape(node, pos));
    group.appendChild(label);
    if (node.version) {
        const version = el('text', { class: 'node__version', x: pos.x, y: pos.y + 50, 'text-anchor': 'middle' });
        version.textContent = node.version;
        group.appendChild(version);
    }
    group.addEventListener('click', () => {
        onClick(node);
    });
    svg.appendChild(group);
}

/**
 * Draws a parent/kind column graph into an SVG element.
 *
 * @param {SVGElement} svg - target
 * @param {object} graph - topology contract
 * @param {function} onClick - selected node callback
 * @returns {void}
 *
 * @example
 *   draw(svg, graph, (node) => show(panel, node));
 */
export default function draw(svg, graph, onClick) {
    while (svg.firstChild) {
        svg.removeChild(svg.firstChild);
    }
    const columns = Math.max(shops(graph.nodes).length, 1);
    svg.setAttribute('viewBox', `0 0 ${Math.max(960, columns * 280 + 120)} 520`);
    const positions = placed(graph);
    paintLink(svg, graph, positions);
    graph.nodes.forEach((node) => {
        if (positions[node.id]) {
            paintNode(svg, node, positions[node.id], onClick);
        }
    });
}
