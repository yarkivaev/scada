import { clickhouseSink } from '../../infrastructure/streams/index.js';
import centralMetricsSink from '../../infrastructure/ingest/telemetry/centralMetricsSink.js';
import centralPolicy from '../../infrastructure/ingest/telemetry/centralPolicy.js';

export function validateTelemetryPolicy(spec) {
    if (!spec.telemetryPolicy) { return; }
    centralPolicy(spec.telemetryPolicy);
    if ((centralPolicy(spec.telemetryPolicy).enabled && !spec.telemetryAmqp) || (spec.table && spec.table !== 'scada.metrics')) {
        throw new TypeError('Central telemetry policy requires telemetryAmqp and scada.metrics table');
    }
}
/** One central policy path shared by all portable ClickHouse ingest adapters. */
export default function telemetrySink(spec) {
    validateTelemetryPolicy(spec);
    const url = spec.clickhouse ?? spec.clickhouseUrl;
    if (!spec.telemetryPolicy && spec.table && spec.table !== 'scada.metrics') { return clickhouseSink(url,spec.table); }
    return centralMetricsSink({ CLICKHOUSE_URL: url, AMQP_URL: spec.telemetryAmqp, CENTRAL_TELEMETRY_POLICY: spec.telemetryPolicy ? JSON.stringify(spec.telemetryPolicy) : undefined });
}
