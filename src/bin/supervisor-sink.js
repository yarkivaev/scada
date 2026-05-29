/**
 * Supervisor-sink service entry point.
 */
process.on('unhandledRejection', (err) => {
    process.stderr.write(`Unhandled rejection: ${String(err)}\n`);
    process.exit(1);
});

import supervisorSink from '../application/supervisorSink.js';
import runRetention from '../infrastructure/ingest/db/runRetention.js';
import edgeApi from '../infrastructure/http/edge/edgeApi.js';

const sink = supervisorSink(process.env);
const http = edgeApi(sink.dataAccess, {
    port: sink.apiPort,
    token: sink.apiToken,
    metricsEnabled: sink.metricsEnabled,
    retentionEnabled: sink.retentionEnabled,
    retentionDays: sink.retentionDays,
    requestTimeoutMs: sink.requestTimeoutMs,
    pool: sink.pool,
    runRetention
});

sink.run(http).catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
});
