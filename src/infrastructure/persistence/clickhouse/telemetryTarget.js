import { requireTelemetryTimestamps } from './jsonMetrics.js';
import insertMetricRows from './insertMetricRows.js';

/** Read every Float64 bit pattern at each timestamp for exact backfill verification. */
export default function clickhouseTelemetryTarget(client, window = {}) {
    return {
        async insertRows(rows) {
            if (!rows.length) { return; }
            requireTelemetryTimestamps(rows, window);
            await insertMetricRows(client, rows);
        },
        async canonical(topic, first, last) {
            const result = await client.query({
                query: `SELECT toString(toUnixTimestamp64Micro(ts)) AS epochMicro,
                    groupUniqArray(toString(reinterpretAsUInt64(value))) AS valueBits FROM scada.metrics
                    WHERE topic={topic:String} AND ts >= {first:DateTime64(6,'UTC')}
                    AND ts <= {last:DateTime64(6,'UTC')} GROUP BY ts ORDER BY ts`,
                query_params: { topic, first, last },
                format: 'JSONEachRow',
                clickhouse_settings: {
                    max_execution_time: 120, output_format_json_quote_64bit_integers: 1,
                    max_result_rows: 100000, max_result_bytes: 33554432, result_overflow_mode: 'throw'
                }
            });
            return result.json();
        }
    };
}

/** Prevent offline writes from bypassing coordinated history admission. */
export async function assertClickhouseBackfillMode(client, mode) {
    if (mode === 'verify') { return; }
    const result = await client.query({
        query: "SELECT comment FROM system.tables WHERE database='scada' AND name='metrics'",
        format: 'JSONEachRow'
    });
    const rows = await result.json();
    if (rows.some(({ comment }) => { return comment?.startsWith('scada.local-history:'); })) {
        throw new Error('History-owned ClickHouse target requires coordinated admission; offline copy/repair is disabled');
    }
}
