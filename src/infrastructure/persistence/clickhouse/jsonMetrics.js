import telemetryTimestamp from '../../../domain/ingest/telemetryTimestamp.js';

export function requireTelemetryTimestamps(rows, {
    clock = Date.now,
    minTimestamp = -Infinity,
    maxFutureMs = Infinity
} = {}) {
    const now = clock();
    for (const row of rows) {
        const instant = telemetryTimestamp(row.ts);
        if (!Number.isFinite(instant) || instant > now + maxFutureMs || instant < minTimestamp) {
            throw new Error(`Telemetry timestamp is outside the admitted window topic=${row.topic} ts=${row.ts}`);
        }
    }
}

/** Write original raw timestamps to ClickHouse without rounding or synthesizing timestamps. */
export default function clickhouseJsonMetrics(client, { table = 'scada.metrics', ...window } = {}) {
    return {
        requireTimestamp: true,
        async insertRows(rows, context) {
            requireTelemetryTimestamps(rows, window);
            return await client.insert({ table, values: rows, format: 'JSONEachRow', abort_signal: context?.signal });
        }
    };
}
