import http from 'http';
import { createEdgeApi } from './edgeApi.js';

/**
 * Starts a test edge HTTP server on ephemeral port.
 *
 * @param {object} dataAccess - persistence backends
 * @param {object} options - token, port
 * @returns {Promise<{baseUrl: string, stop: function}>}
 */
export default async function startTestEdgeApi(dataAccess, options) {
    const opt = options || {};
    const token = Object.hasOwn(opt, 'token') ? opt.token : null;
    const port = Object.hasOwn(opt, 'port') ? opt.port : 0;
    const api = createEdgeApi(dataAccess, { token });
    const server = http.createServer((req, res) => {
        return api.handle(req, res);
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            resolve();
        });
    });
    const addr = server.address();
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    async function stop() {
        await new Promise((resolve, reject) => {
            server.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
    return { baseUrl, stop };
}
