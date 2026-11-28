import { createServer } from 'node:http';
import periodicReconciliation from '../../application/control/periodicReconciliation.js';

/** Serve a control API while polling its independent reconciliation. */
export default function serveReconciliation({ run, respond, port, host, intervalMs = 5000, onError }) {
    const server = createServer(respond);
    server.listen(port, host);
    const loop = periodicReconciliation(run, { intervalMs, onError });
    let stopping;
    return {
        address() { return server.address(); },
        stop() {
            stopping ??= Promise.all([loop.stop(), new Promise((resolve) => { server.close(resolve); })]);
            return stopping;
        }
    };
}
