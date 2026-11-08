import { createClient } from '@clickhouse/client';
import metricsRelation from './metricsRelation.js';

export const LEGACY_METRICS_SQL = `CREATE TABLE IF NOT EXISTS scada.metrics (
    topic String, ts DateTime64(3), value Float64
) ENGINE = MergeTree ORDER BY (topic,ts)`;

export const CANONICAL_METRICS_SQL = `CREATE TABLE IF NOT EXISTS scada.metrics_canonical (
    topic String, ts DateTime64(3,'UTC'), value Float64
) ENGINE = ReplacingMergeTree ORDER BY (topic,ts)`;

async function prepare(client) {
    await client.command({ query: 'CREATE DATABASE IF NOT EXISTS scada' });
    await client.command({ query: LEGACY_METRICS_SQL });
    await client.command({ query: CANONICAL_METRICS_SQL });
    const result = await client.query({ query: `SELECT engine,sorting_key,partition_key FROM system.tables
        WHERE database='scada' AND name='metrics_canonical'`, format: 'JSONEachRow' });
    const [table] = await result.json();
    if (table?.engine !== 'ReplacingMergeTree' || table.sorting_key.replaceAll(' ', '') !== 'topic,ts' || table.partition_key !== '') {
        throw new Error('Central canonical metrics requires ReplacingMergeTree ordered by (topic,ts)');
    }
    const columns = await client.query({ query: `SELECT name,type FROM system.columns
        WHERE database='scada' AND table='metrics_canonical' ORDER BY position`, format: 'JSONEachRow' });
    const shape = (await columns.json()).map((column) => { return `${column.name}:${column.type}`; }).join(',');
    if (shape !== "topic:String,ts:DateTime64(3, 'UTC'),value:Float64") { throw new Error('Incompatible central canonical metrics columns'); }
    await client.command({ query: `CREATE VIEW IF NOT EXISTS scada.metrics_read AS SELECT * FROM ${metricsRelation}` });
}

/** Idempotent projection of durable PostgreSQL decisions, including ambiguous retries. */
export default function canonicalMetrics(url) {
    const client = createClient({ url, request_timeout: 10000 });
    let ready;
    return {
        async write(records) {
            // A failed initial DDL can be retried; never cache a rejected preparation.
            ready ??= prepare(client).catch((error) => { ready = undefined; throw error; });
            await ready;
            await client.insert({ table: 'scada.metrics_canonical', format: 'JSONEachRow', values: records.map((record) => {
                return { ...record, ts: new Date(record.ts).toISOString().replace('T', ' ').replace('Z', '') };
            }) });
        },
        stop() { return client.close(); }
    };
}
