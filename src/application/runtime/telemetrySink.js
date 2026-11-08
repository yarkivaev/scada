import { clickhouseSink } from '../../infrastructure/streams/index.js';
import centralMetricsSink from '../../infrastructure/ingest/telemetry/centralMetricsSink.js';
import centralPolicy from '../../infrastructure/ingest/telemetry/centralPolicy.js';

export function validateTelemetryPolicy(spec) {
    if (!spec.telemetryPolicy) { return; }
    centralPolicy(spec.telemetryPolicy);
    if (!spec.postgres || (spec.table && spec.table !== 'scada.metrics')) {
        throw new TypeError('Central telemetry policy requires postgres and scada.metrics table');
    }
}
/** One central policy path shared by all portable ClickHouse ingest adapters. */
export default function telemetrySink(spec, pool) {
    validateTelemetryPolicy(spec);
    const url = spec.clickhouse ?? spec.clickhouseUrl;
    if (!spec.telemetryPolicy) { return clickhouseSink(url, spec.table ?? 'scada.metrics'); }
    return centralMetricsSink({ CLICKHOUSE_URL: url, CENTRAL_TELEMETRY_POLICY: JSON.stringify(spec.telemetryPolicy) }, pool);
}
