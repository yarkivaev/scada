/** Finish durable history work before acknowledging a telemetry write. */
export default function historyTelemetryMetrics(metrics, history) {
    return {
        ...metrics,
        requireTimestamp: true,
        async insertRows(records, context = {}) {
            context.signal?.throwIfAborted();
            await history.prepare(records);
            context.signal?.throwIfAborted();
            await metrics.insertRows(records, context);
            context.signal?.throwIfAborted();
            await history.complete(records);
        }
    };
}
