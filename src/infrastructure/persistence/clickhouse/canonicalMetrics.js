import { createClient } from '@clickhouse/client';
import metricsRelation, { rawMetricsRelation } from './metricsRelation.js';
import compactMetricsSchema from './compactMetricsSchema.js';
import compactMetricsAdmission from './compactMetricsAdmission.js';
import centralPoint from '../../ingest/telemetry/centralPoint.js';
export { LEGACY_METRICS_SQL, COMPACT_METRICS_SQL } from './compactMetricsSchema.js';

/** Only the serialized SAC head may use this admission writer. */
export default function canonicalMetrics(url, domain) {
    const client = createClient({ url, request_timeout: 10000 });
    let ready;
    function start() {
        ready ??= compactMetricsSchema(client, domain, metricsRelation, rawMetricsRelation).catch((error) => { ready = undefined; throw error; });
        return ready;
    }
    return {
        start,
        async write(records) {
            const points = records.map((record) => {
                if (!Number.isSafeInteger(record.thinWindowMs) || record.thinWindowMs < 0) { throw new TypeError('Invalid frozen central thinning window'); }
                return { ...centralPoint(record), thinWindowMs: record.thinWindowMs };
            });
            await start();
            await compactMetricsAdmission(client, points);
        },
        stop() { return client.close(); }
    };
}
