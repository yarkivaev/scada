import positions from './graphLayout.js';

const SVG = 'http://www.w3.org/2000/svg';

function shops(nodes) {
    return nodes.filter((node) => {
        return node.kind === 'shop';
    });
}

function floor(placed) {
    const ys = Object.values(placed).map((item) => {
        return item.y + 80;
    });
    return Math.max(520, ...ys);
}

function el(name, attrs) {
    const node = document.createElementNS(SVG, name);
    Object.entries(attrs).forEach(([key, value]) => {
        node.setAttribute(key, String(value));
    });
    return node;
}

function paintLink(svg, graph, laid) {
    graph.links.forEach((link) => {
        const from = laid[link.from];
        const to = laid[link.to];
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
    const laid = positions(graph);
    svg.setAttribute('viewBox', `0 0 ${Math.max(960, columns * 280 + 120)} ${floor(laid)}`);
    paintLink(svg, graph, laid);
    graph.nodes.forEach((node) => {
        if (laid[node.id]) {
            paintNode(svg, node, laid[node.id], onClick);
        }
    });
}
