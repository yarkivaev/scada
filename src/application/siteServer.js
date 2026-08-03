import { clickhouseSink } from '@yarkivaev/source-to-sink';
import supervisorSink from './supervisorSink.js';
import plantServer from './plantServer.js';
import plantOperations from './plantOperations.js';
import edgeApi from '../infrastructure/http/edge/edgeApi.js';
import runRetention from '../infrastructure/ingest/db/runRetention.js';
import mqttMetrics from '../infrastructure/ingest/mqtt/mqttMetrics.js';
import amqpMetricsIngest from '../infrastructure/ingest/telemetry/amqpMetricsIngest.js';
import operationSyncIngest from '../infrastructure/sync/operationSyncIngest.js';
import { metricsSinkFromPool } from '../infrastructure/persistence/pg/metrics.js';
import bindSilentStreams from './bindSilentStreams.js';
import timelineOperatorFromEnv from './timelineOperatorFromEnv.js';
import siteOperatorCatalog from './siteOperatorCatalog.js';

function stompFromEnv(env) {
    return {
        url: env.STOMP_URL,
        login: env.STOMP_LOGIN || 'guest',
        passcode: env.STOMP_PASSCODE || 'guest',
        host: env.STOMP_HOST || '/',
        operatorUser: env.HMI_OPERATOR_USER || 'hmi-kiosk'
    };
}

function mqttConfigFromEnv(env) {
    return {
        size: parseInt(env.BATCH_SIZE || '50', 10),
        interval: parseInt(env.FLUSH_INTERVAL || '5', 10),
        threshold: parseInt(env.CIRCUIT_THRESHOLD || '5', 10),
        timeout: parseInt(env.CIRCUIT_TIMEOUT || '60', 10),
        clientId: env.CLIENT_ID,
        sessionExpiryInterval: parseInt(env.SESSION_EXPIRY || '3600', 10)
    };
}

function mqttSinkForProfile(sink, env) {
    const profile = env.SINK_DB_PROFILE === 'central' ? 'central' : 'edge';
    if (profile === 'edge') {
        return metricsSinkFromPool(sink.pool);
    }
    const url = env.CLICKHOUSE_URL
        || (env.CLICKHOUSE_HOST ? `http://${env.CLICKHOUSE_HOST}:8123` : undefined);
    if (!url) {
        throw new Error('CLICKHOUSE_URL or CLICKHOUSE_HOST is required for central MQTT metrics');
    }
    return clickhouseSink(url, 'scada.metrics');
}

function startMqtt(sink, env) {
    if (!env.MQTT_URL || !env.MQTT_TOPICS) {
        return undefined;
    }
    const metricsSink = mqttSinkForProfile(sink, env);
    const pipeline = mqttMetrics(env.MQTT_URL, metricsSink, env.MQTT_TOPICS, mqttConfigFromEnv(env));
    pipeline.start();
    return pipeline;
}

function startOperationSync(sink, env) {
    if (env.SINK_DB_PROFILE === 'edge' || !env.AMQP_URL) {
        return undefined;
    }
    const ingest = operationSyncIngest(
        env.AMQP_URL,
        env.AMQP_OPERATIONS_QUEUE || 'scada.operations.ingest',
        sink.dataAccess.operations,
        { prefetch: parseInt(env.AMQP_PREFETCH || '32', 10) }
    );
    ingest.start();
    return ingest;
}

function clickhouseMetricsUrl(env) {
    return env.CLICKHOUSE_URL
        || (env.CLICKHOUSE_HOST ? `http://${env.CLICKHOUSE_HOST}:8123` : undefined);
}

function startAmqpMetrics(env, sink, onSeen) {
    if (!env.AMQP_URL) {
        return undefined;
    }
    const batchConfig = mqttConfigFromEnv(env);
    const ingest = amqpMetricsIngest(
        env.AMQP_URL,
        env.AMQP_QUEUE || 'scada.telemetry.ingest',
        sink,
        {
            size: batchConfig.size,
            interval: batchConfig.interval,
            threshold: batchConfig.threshold,
            timeout: batchConfig.timeout,
            prefetch: parseInt(env.AMQP_PREFETCH || '32', 10),
            onSeen
        }
    );
    ingest.start();
    return ingest;
}

function startTelemetryIngest(env, streams) {
    if (env.SINK_DB_PROFILE === 'edge' || (!env.AMQP_URL && !streams)) {
        return undefined;
    }
    const url = clickhouseMetricsUrl(env);
    if (!url) {
        throw new Error('CLICKHOUSE_URL or CLICKHOUSE_HOST is required for AMQP telemetry ingest');
    }
    const sink = clickhouseSink(url, 'scada.metrics');
    const onSeen = bindSilentStreams(streams, sink);
    const ingest = startAmqpMetrics(env, sink, onSeen);
    if (streams) {
        streams.start();
    }
    return { ingest, streams };
}

function plantFactoryWithOperations(plantFactory, ops, sink) {
    return (ctx) => {
        const built = plantFactory({ ...ctx, operations: ops }, sink);
        return Promise.resolve(built).then((p) => {
            if (p.operations) {
                return p;
            }
            return {
                ...p,
                operations: ops,
                init() {
                    p.init();
                }
            };
        });
    };
}

function siteExtraRoutes(catalog, extraRoutes) {
    return (path, plant, clock) => {
        const userExtra = extraRoutes ? extraRoutes(path, plant, clock) : [];
        return [...catalog.routes, ...userExtra];
    };
}

/**
 * Unified site process: supervisor-sink HTTP, plant API, and optional MQTT ingest.
 *
 * @param {object} config - port, basePath, translations, requirePool, plantFactory, extraRoutes, kindSources, streams, env
 * @returns {Promise<object>} sink, plant, mqtt pipeline
 *
 * @example
 *   await siteServer({ plantFactory: ({ alerts, userDecisions }, sink) => edgePlant(machines, { metrics: sink.dataAccess.metrics, alerts, userDecisions }), kindSources: { temp } });
 */
export default async function siteServer(config) {
    const env = config.env || process.env;
    const sink = supervisorSink(env);
    const ops = plantOperations(
        sink.dataAccess.operations,
        config.kindSources || config.operationSources
    );
    sink.dataAccess.operations = ops;
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
    await sink.run(http);
    const mqtt = startMqtt(sink, env);
    const telemetry = startTelemetryIngest(env, config.streams);
    const operationSync = startOperationSync(sink, env);
    const basePath = config.basePath || '/api/v1';
    const catalog = siteOperatorCatalog(basePath, sink, env);
    if (catalog.sync) {
        await catalog.sync.start();
    }
    const plant = await plantServer({
        port: config.port || parseInt(env.PORT || '3000', 10),
        basePath,
        translations: config.translations,
        requirePool: config.requirePool,
        stomp: stompFromEnv(env),
        plantFactory: plantFactoryWithOperations(config.plantFactory, ops, sink),
        extraRoutes: siteExtraRoutes(catalog, config.extraRoutes),
        timelineOperator: timelineOperatorFromEnv(catalog, env, config),
        operationDecisions: catalog.decisions,
        owners: config.owners
    });
    return { sink, plant, mqtt, telemetry, operationSync, operatorsSync: catalog.sync };
}
