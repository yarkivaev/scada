import amqpSource from '../../streams/amqpSource.js';
import { metricsSinkFromPool } from '../../persistence/pg/metrics.js';
import deliverToMqttRecord from './deliverToMqttRecord.js';

/** Source acknowledgement follows this promise: telemetry and history work commit first. */
export async function persistTelemetry(sink, delivery) {
    const record = deliverToMqttRecord(delivery.fields, delivery.content);
    let point;
    try { point = JSON.parse(record.payload.toString()); } catch { throw new TypeError('Invalid local telemetry JSON'); }
    if (!point || !Number.isSafeInteger(point.ts) || !Number.isFinite(point.value)) { throw new TypeError('Invalid local telemetry timestamp or value'); }
    await sink.write([{ topic: record.topic, ts: point.ts, value: point.value }]);
}
/** Node-owned receiver; independent of relocatable collectors and MQTT sessions. */
export default function historyTelemetry(env, pool) {
    if (env.HISTORY_AMQP_ENABLED !== 'true' || env.SINK_DB_PROFILE === 'central') { return undefined; }
    const url = env.HISTORY_AMQP_URL ?? env.AMQP_URL;
    if (!url) { throw new TypeError('HISTORY_AMQP_URL or AMQP_URL required for durable local telemetry'); }
    if (!env.HISTORY_AMQP_BINDINGS) { throw new TypeError('Explicit local telemetry bindings required'); }
    const bindings = JSON.parse(env.HISTORY_AMQP_BINDINGS);
    if (!Array.isArray(bindings) || !bindings.length || bindings.some((pattern) => { return typeof pattern !== 'string' || !pattern; })) {
        throw new TypeError('Local telemetry binding patterns required');
    }
    const sink = metricsSinkFromPool(pool, { firstWins: true });
    return amqpSource(url, env.HISTORY_AMQP_QUEUE ?? 'scada.telemetry.history', {
        accept(delivery) { return persistTelemetry(sink, delivery); }
    }, {
        prefetch: Number(env.HISTORY_AMQP_PREFETCH ?? 32), queueOptions: { durable: true, autoDelete: false },
        exchanges: [{ name: 'scada.telemetry', type: 'topic', options: { durable: true } }],
        bindings: bindings.map((pattern) => { return { exchange: 'scada.telemetry', pattern }; })
    });
}
