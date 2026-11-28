import { addAbortSignal, Readable } from 'node:stream';
import rowBinary from './rowBinary.js';

/** Write exact telemetry rows and wait for ClickHouse to finish the response. */
export default async function insertMetricRows(client, rows, { signal } = {}) {
    if (!rows.length) { return; }
    signal?.throwIfAborted();
    const response = await client.exec({
        query: 'INSERT INTO scada.metrics (topic, ts, value) FORMAT RowBinary',
        values: Readable.from(rowBinary(rows), { objectMode: false }),
        abort_signal: signal,
        clickhouse_settings: { wait_end_of_query: 1, async_insert: 0 }
    });
    if (signal) { addAbortSignal(signal, response.stream); }
    for await (const chunk of response.stream) {
        if (chunk.length) { throw new Error('Unexpected ClickHouse telemetry insertion response'); }
    }
    signal?.throwIfAborted();
}
