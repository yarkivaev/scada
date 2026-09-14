import net from 'node:net';

/**
 * Parses /infra/inspect/:id/... into node id and upstream path.
 *
 * @param {string} url - request URL
 * @returns {{id: string, path: string}|undefined} match
 */
export function inspectUrl(url) {
    const path = url.split('?')[0];
    const match = path.match(/^\/infra\/inspect\/(?<id>[^/]+)\/(?<rest>.*)$/u);
    if (!match) {
        return undefined;
    }
    return { id: match.groups.id, path: `/${match.groups.rest}` };
}

function inspectOf(plant, id) {
    if (typeof plant.topology !== 'function') {
        return undefined;
    }
    const node = plant.topology().nodes.find((item) => {
        return item.id === id;
    });
    return node && node.inspect;
}

function writeUpgrade(upstream, req, target, path, head) {
    const lines = [
        `GET ${path} HTTP/1.1`,
        `Host: 127.0.0.1:${target.port}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        `Sec-WebSocket-Version: ${req.headers['sec-websocket-version'] || '13'}`,
        `Sec-WebSocket-Key: ${req.headers['sec-websocket-key']}`
    ];
    if (req.headers['sec-websocket-protocol']) {
        lines.push(`Sec-WebSocket-Protocol: ${req.headers['sec-websocket-protocol']}`);
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head && head.length) {
        upstream.write(head);
    }
}

/**
 * Upgrades a same-origin inspect websocket onto the node debug port.
 *
 * @param {object} plant - plant with topology()
 * @param {object} req - HTTP upgrade request
 * @param {object} socket - client socket
 * @param {Buffer} head - leftover bytes
 * @returns {void}
 *
 * @example
 *   server.on('upgrade', (req, socket, head) => inspectUpgrade(plant, req, socket, head));
 */
export default function inspectUpgrade(plant, req, socket, head) {
    const match = inspectUrl(req.url);
    const target = match ? inspectOf(plant, match.id) : undefined;
    if (!match || !target) {
        socket.destroy();
        return;
    }
    const upstream = net.connect(target.port, target.host, () => {
        writeUpgrade(upstream, req, target, match.path, head);
        upstream.pipe(socket);
        socket.pipe(upstream);
    });
    upstream.on('error', () => {
        socket.destroy();
    });
    socket.on('error', () => {
        upstream.destroy();
    });
}
