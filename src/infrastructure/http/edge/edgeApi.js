import http from 'http';
import checkpointRoutes from './routes/checkpoint/checkpointRoutes.js';
import metricsRoutes from './routes/metrics/metricsRoutes.js';
import retentionRoutes from './routes/retention/retentionRoutes.js';
import { routes } from '@yarkivaev/simple-server';

/**
 * Builds edge HTTP API (metrics, checkpoint, retention only).
 *
 * @param {object} dataAccess - metrics and checkpoints backends
 * @param {object} [options] - token, retention, metrics flags
 * @returns {object} routes with list() and handle()
 */
export function createEdgeApi(dataAccess, options) {
    const opt = options || {};
    const token = Object.hasOwn(opt, 'token') ? opt.token : null;
    const retentionDays = opt.retentionDays ?? 30;
    const metricsEnabled = opt.metricsEnabled !== false;
    const { metrics, checkpoints } = dataAccess;
    const purge = opt.runRetention;
    const admin = opt.retentionEnabled && opt.pool && purge
        ? retentionRoutes(token, opt.pool, retentionDays, purge)
        : [];
    const metricRoutes = metricsEnabled
        ? metricsRoutes(token, metrics)
        : [];
    return routes([
        ...admin,
        ...checkpointRoutes(token, checkpoints),
        ...metricRoutes
    ], { requestTimeoutMs: opt.requestTimeoutMs });
}

/**
 * HTTP server for edge persistence API (/v1).
 *
 * @param {object} dataAccess - injected persistence backends
 * @param {object} options - listen port, auth token, retention, metrics flags
 * @returns {object} server with start() and stop()
 */
export default function edgeApi(dataAccess, options) {
    const api = createEdgeApi(dataAccess, options);
    const server = http.createServer((req, res) => {
        return api.handle(req, res);
    });
    return {
        start() {
            server.listen(options.port);
        },
        stop() {
            server.close();
        }
    };
}
