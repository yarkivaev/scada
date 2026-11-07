import { createServer } from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';

function response(runtime, histogram, request, result) {
    if (!['/live', '/ready', '/status'].includes(request.url)) { result.writeHead(404).end(); return; }
    const state = runtime.status();
    const ready = !state.fatal && !state.stopping && !state.tasks.some((task) => {
        return task.state === 'failed' || ['failed', 'degraded'].includes(task.health);
    });
    const body = request.url === '/status' ? { ...state, memory: process.memoryUsage(), eventLoopP99Ms: histogram.percentile(99) / 1e6 } : { ready };
    result.writeHead((request.url === '/ready' && !ready) || (request.url === '/live' && state.fatal) ? 503 : 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    result.end(JSON.stringify(body));
}
/** Read-only health surface. A blocked event loop cannot answer an external probe. */
export default async function runtimeHealth(runtime, { port, host = '127.0.0.1' }) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) { throw new TypeError('Invalid health port'); }
    const histogram = monitorEventLoopDelay({ resolution: 20 });
    const server = createServer((request, result) => { response(runtime, histogram, request, result); });
    server.requestTimeout = 2000;
    server.headersTimeout = 2000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    histogram.enable();
    return {
        port: server.address().port,
        stop() {
            histogram.disable();
            server.closeAllConnections();
            return new Promise((resolve, reject) => { server.close((error) => { if (error) { reject(error); } else { resolve(); } }); });
        }
    };
}
