export const LEGACY_METRICS_SQL = `CREATE TABLE IF NOT EXISTS scada.metrics (
    topic String, ts DateTime64(3), value Float64
) ENGINE = MergeTree ORDER BY (topic,ts)`;
export const COMPACT_METRICS_SQL = `CREATE TABLE IF NOT EXISTS scada.metrics_compact_v2 (
    topic String, bucket_start Int64, bucket_ms UInt64, thin_ms UInt64,
    value Float64, stamps AggregateFunction(groupBitmap,UInt64)
) ENGINE = AggregatingMergeTree ORDER BY (topic,bucket_start,bucket_ms,thin_ms,value)`;

function tableShape(table,domain) {
    if (table?.comment !== `scada-admission-v2:${domain}`) { throw new Error('Central admission domain differs from the existing canonical table'); }
    if (table.engine !== 'AggregatingMergeTree' || table.sorting_key.replaceAll(' ','') !== 'topic,bucket_start,bucket_ms,thin_ms,value' || table.partition_key !== '') {
        throw new Error('Incompatible central bitmap storage engine or key');
    }
}
async function columnShape(client) {
    const response = await client.query({query:`SELECT name,type FROM system.columns
        WHERE database='scada' AND table='metrics_compact_v2' ORDER BY position`,format:'JSONEachRow'});
    const shape = (await response.json()).map((column) => { return `${column.name}:${column.type}`; }).join(',');
    if (shape !== 'topic:String,bucket_start:Int64,bucket_ms:UInt64,thin_ms:UInt64,value:Float64,stamps:AggregateFunction(groupBitmap, UInt64)') {
        throw new Error('Incompatible central bitmap storage columns');
    }
}
async function readView(client,name,relation) {
    const response = await client.query({query:`SELECT engine,create_table_query FROM system.tables WHERE database='scada' AND name={name:String}`,query_params:{name},format:'JSONEachRow'});
    const [view] = await response.json();
    if (view && (view.engine !== 'View' || !view.create_table_query.includes('metrics_compact_v2'))) {
        throw new Error('Previous canonical read view needs an explicit v2 migration');
    }
    await client.command({query:`CREATE VIEW IF NOT EXISTS scada.${name} AS SELECT * FROM ${relation}`});
}
/** Atomic CREATE TABLE pins one broker/vhost/queue without per-point metadata. */
export default async function compactMetricsSchema(client,domain,relation,rawRelation) {
    if (!/^[a-f0-9]{64}$/u.test(domain)) { throw new TypeError('Invalid central admission domain'); }
    await client.command({query:'CREATE DATABASE IF NOT EXISTS scada'});
    await client.command({query:LEGACY_METRICS_SQL});
    const old = await client.query({query:"SELECT name FROM system.tables WHERE database='scada' AND name='metrics_canonical'",format:'JSONEachRow'});
    if ((await old.json()).length) { throw new Error('Previous review canonical storage needs an explicit data migration before v2 activation'); }
    await client.command({query:`${COMPACT_METRICS_SQL} COMMENT 'scada-admission-v2:${domain}'`});
    const response = await client.query({query:`SELECT engine,sorting_key,partition_key,comment FROM system.tables
        WHERE database='scada' AND name='metrics_compact_v2'`,format:'JSONEachRow'});
    tableShape((await response.json())[0],domain);
    await columnShape(client);
    await readView(client,'metrics_read',relation);
    await readView(client,'metrics_raw_read',rawRelation);
}
