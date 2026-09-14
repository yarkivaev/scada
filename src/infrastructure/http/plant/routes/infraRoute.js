import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { route } from '@yarkivaev/simple-server';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../ui');

/**
 * Sends a static file next to the infra UI module.
 *
 * @param {object} res - HTTP response
 * @param {string} name - file path relative to ui/
 * @param {string} type - Content-Type
 * @returns {void}
 */
function sendFile(res, name, type) {
    res.writeHead(200, { 'Content-Type': type });
    res.end(readFileSync(join(dir, name)));
}

/**
 * Site-server topology page and its static assets.
 *
 * @returns {array} route objects
 *
 * @example
 *   infraRoute();
 */
export default function infraRoute() {
    return [
        route('GET', '/infra', (req, res) => {
            sendFile(res, 'infra.html', 'text/html; charset=utf-8');
        }),
        route('GET', '/infra/', (req, res) => {
            sendFile(res, 'infra.html', 'text/html; charset=utf-8');
        }),
        route('GET', '/infra/app.js', (req, res) => {
            sendFile(res, 'infra/app.js', 'text/javascript; charset=utf-8');
        }),
        route('GET', '/infra/app.css', (req, res) => {
            sendFile(res, 'infra/app.css', 'text/css; charset=utf-8');
        }),
        route('GET', '/infra/graph.js', (req, res) => {
            sendFile(res, 'infra/graph.js', 'text/javascript; charset=utf-8');
        }),
        route('GET', '/infra/panel.js', (req, res) => {
            sendFile(res, 'infra/panel.js', 'text/javascript; charset=utf-8');
        })
    ];
}
