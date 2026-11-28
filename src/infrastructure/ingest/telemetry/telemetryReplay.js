import telemetryTimestamp from '../../../domain/ingest/telemetryTimestamp.js';

/** Encode a stored point as a persistent AMQP publish with its original millisecond timestamp. */
export default function telemetryReplay(row, exchange = 'scada.telemetry') {
    const instant = Math.trunc(telemetryTimestamp(row.ts));
    if (!Number.isSafeInteger(instant) || !Number.isFinite(row.value)) {
        throw new Error(`Replay requires original integer timestamp and finite value topic=${row.topic} ts=${row.ts}`);
    }
    return {
        exchange,
        routingKey: String(row.topic).replaceAll('/', '.'),
        payload: JSON.stringify({ ts: instant, value: row.value }),
        persistent: true
    };
}
