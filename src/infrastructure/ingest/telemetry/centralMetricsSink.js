import { clickhouseSink } from '../../streams/index.js';
import centralQueueSession, { centralQueueOptions } from './centralQueueSession.js';
import amqpSink from '../../streams/amqpSink.js';
import centralPolicy from './centralPolicy.js';
import centralPoint from './centralPoint.js';
import canonicalMetrics from '../../persistence/clickhouse/canonicalMetrics.js';
import centralTelemetryPreflight from './centralTelemetryPreflight.js';
import { admissionDomain, encodeBatch, targetIdentity } from './centralEnvelope.js';
/* eslint-disable no-await-in-loop */

function legacySink(env,url) {
    const raw = clickhouseSink(url,'scada.metrics');
    return {start() {return centralTelemetryPreflight(env);},async write(records,context) {
        await centralTelemetryPreflight(env);return raw.write(records,context);
    },stop() {return raw.stop();}};
}

/** All producers use one durable SAC queue; only its serialized head writes CH. */
export default function centralMetricsSink(env) {
    const policy = centralPolicy(env.CENTRAL_TELEMETRY_POLICY ?? {});
    const url = env.CLICKHOUSE_URL || (env.CLICKHOUSE_HOST ? `http://${env.CLICKHOUSE_HOST}:8123` : undefined);
    if (!policy.enabled) { return legacySink(env,url); }
    if (!env.AMQP_URL) { throw new TypeError('Enabled central telemetry policy requires AMQP_URL'); }
    const target = targetIdentity(url);
    const projection = canonicalMetrics(url, admissionDomain(env.AMQP_URL, policy.queue, target));
    const queueOptions = centralQueueOptions(policy);
    const state = { stopped: false, opening: null, error: null };
    function failure(error) {
        if (state.error?.message !== error.message) { process.stderr.write(`[scada] central admission blocked: ${error.message}\n`); }
        state.error = error;
    }
    const publisher = amqpSink(env.AMQP_URL, { queues: [{ name: policy.queue, options: queueOptions }], onError: failure });
    const source = centralQueueSession({url:env.AMQP_URL,queue:policy.queue,queueOptions,target},projection,{
        failed:failure,accepted() { state.error = null; }
    });
    function start() {
        if (state.stopped) { return Promise.reject(new Error('Central telemetry sink stopped')); }
        state.opening ??= Promise.all([publisher.start(), source.start()]).catch((error) => { state.opening = null; throw error; });
        return state.opening;
    }
    return {
        requireTimestamp: true, start,
        async write(records, context) {
            const points = records.map(centralPoint);
            const messages = [];
            for (let index = 0; index < points.length; index += policy.batchSize) {
                messages.push({ exchange: '', routingKey: policy.queue,
                    body: encodeBatch(points.slice(index, index + policy.batchSize), policy, target),
                    options: { persistent: true, mandatory: true, contentType: 'application/json' } });
            }
            await start();
            // Confirms establish the durable admission order. ACK source only afterwards.
            for (const message of messages) { await publisher.write([message], context); }
        },
        status() { return { connected: publisher.active(), error: state.error?.message ?? null }; },
        async stop() {
            if (state.stopped) { return; }
            state.stopped = true;
            await state.opening?.catch(() => { return undefined; });
            await Promise.allSettled([source.stop(), publisher.stop()]);
            await projection.stop();
        }
    };
}
