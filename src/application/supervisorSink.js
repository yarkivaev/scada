import segmentPipeline from '../infrastructure/ingest/pipelines/segmentPipeline.js';
import decisionPipeline from '../infrastructure/ingest/pipelines/decisionPipeline.js';
import alertPipeline from '../infrastructure/ingest/pipelines/alertPipeline.js';
import migrate, { migratePrivileged } from '../infrastructure/ingest/db/migrate.js';
import stateDataFromPool from '../infrastructure/persistence/stateDataFromPool.js';
import { parseRequestTimeoutMs } from '../infrastructure/ingest/parseRequestTimeoutMs.js';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const appRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Reads deployment environment into a normalized config object.
 *
 * @param {NodeJS.ProcessEnv} env - process environment
 * @returns {object} deployment configuration
 */
export function readDeploymentConfig(env) {
    const root = path.join(appRoot, '../..');
    return {
        stomp: env.STOMP_URL,
        postgres: env.POSTGRES_URL,
        postgresAdmin: env.POSTGRES_ADMIN_URL,
        apiPort: parseInt(
            env.STATE_HTTP_PORT || env.INTERNAL_API_PORT || '8081',
            10
        ),
        apiToken: env.STATE_HTTP_TOKEN || env.INTERNAL_API_TOKEN,
        sinkDbProfile: env.SINK_DB_PROFILE === 'central' ? 'central' : 'edge',
        retentionEnabled: env.RETENTION_ENABLED === 'true',
        retentionDays: parseInt(env.RETENTION_DAYS || '30', 10),
        migrationsDir: path.join(root, 'db', 'migrations'),
        requestTimeoutMs: parseRequestTimeoutMs(env.REQUEST_TIMEOUT_MS),
        pipeline: {
            size: parseInt(env.BATCH_SIZE || '50', 10),
            interval: parseInt(env.FLUSH_INTERVAL || '2', 10),
            threshold: parseInt(env.CIRCUIT_THRESHOLD || '5', 10),
            timeout: parseInt(env.CIRCUIT_TIMEOUT || '60', 10),
            poll: parseInt(env.POLL_INTERVAL || '5', 10),
            login: env.STOMP_LOGIN || 'guest',
            passcode: env.STOMP_PASSCODE || 'guest',
            host: env.STOMP_HOST || '/'
        }
    };
}

/**
 * Wires STOMP pipelines, migrations, and state data access from env config.
 * HTTP binding uses edgeApi (metrics, checkpoint, retention).
 *
 * @param {NodeJS.ProcessEnv} [env] - process environment, defaults to process.env
 * @returns {object} sink runtime with pool, dataAccess, and run(httpServer?)
 */
export default function supervisorSink(env = process.env) {
    const cfg = readDeploymentConfig(env);
    const pool = new pg.Pool({ connectionString: cfg.postgres });
    const segments = segmentPipeline(cfg.stomp, cfg.postgres, pool, cfg.pipeline);
    const decisions = decisionPipeline(cfg.stomp, pool, cfg.pipeline);
    const alerts = alertPipeline(cfg.stomp, pool, cfg.pipeline);
    const metricsEnabled = cfg.sinkDbProfile === 'edge';
    const dataAccess = stateDataFromPool(pool, { metricsEnabled });
    return {
        apiPort: cfg.apiPort,
        apiToken: cfg.apiToken,
        sinkDbProfile: cfg.sinkDbProfile,
        retentionEnabled: cfg.retentionEnabled,
        retentionDays: cfg.retentionDays,
        requestTimeoutMs: cfg.requestTimeoutMs,
        metricsEnabled,
        pool,
        dataAccess,
        async run(httpServer) {
            if (!cfg.postgresAdmin) {
                throw new Error('POSTGRES_ADMIN_URL is required for supervisor-sink database migrations');
            }
            const adminPool = new pg.Pool({ connectionString: cfg.postgresAdmin });
            try {
                await migrate(adminPool, cfg.migrationsDir, cfg.sinkDbProfile);
                await migratePrivileged(adminPool, cfg.migrationsDir, cfg.sinkDbProfile);
            } finally {
                await adminPool.end();
            }
            segments.start();
            decisions.start();
            alerts.start();
            if (httpServer) {
                httpServer.start();
            }
        }
    };
}
