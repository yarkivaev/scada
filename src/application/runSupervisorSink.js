import supervisorSink from './supervisorSink.js';
import runRetention from '../infrastructure/ingest/db/runRetention.js';
import edgeApi from '../infrastructure/http/edge/edgeApi.js';

/** A terminal reader error rejects the process lifetime, not only one detached task. */
export default async function runSupervisorSink(env, { sinkFactory = supervisorSink, apiFactory = edgeApi } = {}) {
    let fail;
    const failed = new Promise((_resolve, reject) => { fail = reject; });
    const sink = sinkFactory(env, { onFatal: fail });
    const api = apiFactory(sink.dataAccess, {
        port: sink.apiPort, token: sink.apiToken, metricsEnabled: sink.metricsEnabled,
        retentionEnabled: sink.retentionEnabled, retentionDays: sink.retentionDays,
        requestTimeoutMs: sink.requestTimeoutMs, pool: sink.pool, runRetention, health: sink.health
    });
    await Promise.all([sink.run(api), failed]);
}
