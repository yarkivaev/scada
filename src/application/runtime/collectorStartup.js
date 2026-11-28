import { createServer } from 'node:http';

/** Starts only after local recovery. The readiness endpoint tracks individual tasks. */
export default async function collectorStartup(runtime, { port, host }) {
    const server = createServer((request, response) => {
        if (request.url !== '/startup') { response.writeHead(404).end(); return; }
        const state = runtime.status();
        const ready = !state.fatal && !state.stopping;
        response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ localRecoveryComplete: ready }));
    });
    server.requestTimeout = 2000;
    server.headersTimeout = 2000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    let closing;
    return { stop() {
        closing ??= new Promise((resolve, reject) => {
            server.closeAllConnections();
            server.close(error => { if (error) { reject(error); } else { resolve(); } });
        });
        return closing;
    } };
}
