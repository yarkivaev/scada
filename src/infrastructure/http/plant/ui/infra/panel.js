function row(label, value) {
    const line = document.createElement('div');
    line.className = 'panel__row';
    const name = document.createElement('span');
    name.textContent = label;
    const body = document.createElement('span');
    body.textContent = value;
    line.appendChild(name);
    line.appendChild(body);
    return line;
}

function button(label, action) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.addEventListener('click', action);
    return el;
}

function preview(id) {
    const img = document.createElement('img');
    img.className = 'panel__preview';
    img.alt = 'Screen preview';
    img.src = `/infra/inspect/${id}/shot`;
    return img;
}

async function tools(id, host) {
    const frame = document.createElement('iframe');
    frame.className = 'panel__tools';
    frame.title = 'DevTools';
    const response = await fetch(`/infra/inspect/${id}/json/list`);
    const payload = await response.json();
    const page = Array.isArray(payload) ? payload[0] : payload;
    if (page && page.devtoolsFrontendUrl) {
        frame.src = page.devtoolsFrontendUrl;
        return frame;
    }
    frame.srcdoc = `<p>${host}</p>`;
    return frame;
}

function facts(aside, node) {
    aside.appendChild(row('id', node.id));
    aside.appendChild(row('status', node.status || 'unknown'));
    if (node.version) {
        aside.appendChild(row('version', node.version));
    }
}

function actions(aside, node) {
    const bar = document.createElement('div');
    bar.className = 'panel__actions';
    bar.appendChild(button('Preview', () => {
        aside.appendChild(preview(node.id));
    }));
    bar.appendChild(button('DevTools', async () => {
        aside.appendChild(await tools(node.id, node.inspect.host));
    }));
    aside.appendChild(bar);
}

/**
 * Fills the topology side panel for one node.
 *
 * @param {HTMLElement} aside - panel root
 * @param {object} node - topology node
 * @returns {void}
 *
 * @example
 *   show(panel, node);
 */
export default function show(aside, node) {
    aside.hidden = false;
    aside.replaceChildren();
    const kind = document.createElement('p');
    kind.className = 'panel__kind';
    kind.textContent = node.kind;
    const title = document.createElement('h2');
    title.className = 'panel__title';
    title.textContent = node.title;
    aside.appendChild(kind);
    aside.appendChild(title);
    facts(aside, node);
    if (node.inspect) {
        actions(aside, node);
    }
}
