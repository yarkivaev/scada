import draw from './graph.js';
import show from './panel.js';

const title = document.getElementById('plant-title');
const meta = document.getElementById('plant-meta');
const svg = document.getElementById('graph');
const aside = document.getElementById('panel');
const graph = await (await fetch('/api/v1/topology')).json();

title.textContent = graph.plant.title;
meta.textContent = [graph.plant.id, graph.plant.version].filter(Boolean).join(' · ');
draw(svg, graph, (node) => {
    show(aside, node);
});
