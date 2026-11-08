/** Reject invalid identity before storing any part of a batch. */
export default function centralMetricPoint(record) {
    let ts = record.ts instanceof Date ? record.ts.getTime() : record.ts;
    if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(ts)) {
        const parsed = Date.parse(ts);
        if (Number.isFinite(parsed) && new Date(parsed).toISOString() === ts) { ts = parsed; }
    }
    if (typeof record.topic !== 'string' || !record.topic || record.topic.length > 1024
        || !Number.isSafeInteger(ts) || ts < -2208988800000 || ts > 10413791999999 || !Number.isFinite(record.value)) {
        throw new TypeError('Central telemetry requires a logical topic, original millisecond timestamp and finite value');
    }
    return { topic: record.topic, ts, value: record.value };
}

