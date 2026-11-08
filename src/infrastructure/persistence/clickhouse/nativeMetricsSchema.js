export const LEGACY_METRICS_SQL=`CREATE TABLE IF NOT EXISTS scada.metrics (
    topic String, ts DateTime64(3), value Float64
) ENGINE=MergeTree ORDER BY(topic,ts)`;
export const NATIVE_METRICS_SQL=`CREATE TABLE IF NOT EXISTS scada.metrics_points_v3 (
    topic String, ts DateTime64(3), value Float64, compact_ms UInt64, revision UInt128,
    is_compacted UInt8 DEFAULT 0,compact_first Int64 DEFAULT 0,compact_last Int64 DEFAULT 0,compacted_at Int64 DEFAULT 0
) ENGINE=ReplacingMergeTree(revision) PARTITION BY toYYYYMM(ts) ORDER BY(topic,ts)`;
const tables=[
    ['metrics_points_v3',NATIVE_METRICS_SQL,'ReplacingMergeTree','topic,ts','toYYYYMM(ts)','topic:String,ts:DateTime64(3),value:Float64,compact_ms:UInt64,revision:UInt128,is_compacted:UInt8,compact_first:Int64,compact_last:Int64,compacted_at:Int64'],
    ['metrics_state_v3',`CREATE TABLE IF NOT EXISTS scada.metrics_state_v3 (
        key String, latest Int64, closed_before Int64, published_at Int64, committed_seq UInt64, revision UInt128
    ) ENGINE=ReplacingMergeTree(revision) ORDER BY key`,'ReplacingMergeTree','key','','key:String,latest:Int64,closed_before:Int64,published_at:Int64,committed_seq:UInt64,revision:UInt128'],
    ['metrics_rejected_v3',`CREATE TABLE IF NOT EXISTS scada.metrics_rejected_v3 (
        batch_id String,ordinal UInt16,topic String,ts DateTime64(3),value Float64,reason LowCardinality(String),admitted_at DateTime64(3),recorded_at DateTime64(3) DEFAULT now64(3)
    ) ENGINE=ReplacingMergeTree ORDER BY(batch_id,ordinal) TTL toDateTime(recorded_at)+INTERVAL 30 DAY`,'ReplacingMergeTree','batch_id,ordinal','','batch_id:String,ordinal:UInt16,topic:String,ts:DateTime64(3),value:Float64,reason:LowCardinality(String),admitted_at:DateTime64(3),recorded_at:DateTime64(3)']
];
async function installTable(client,domain,[name,sql,engine,key,partition,columns]) {
        await client.command({query:`${sql} COMMENT 'scada-admission-v3:${domain}'`});
        const response=await client.query({query:'SELECT engine,sorting_key,partition_key,comment,create_table_query FROM system.tables WHERE database=\'scada\' AND name={name:String}',query_params:{name},format:'JSONEachRow'});
        const [table]=await response.json();
        if(table?.comment!==`scada-admission-v3:${domain}`){throw new Error('Central admission domain differs from the existing canonical table');}
        const shape=await client.query({query:"SELECT name,type FROM system.columns WHERE database='scada' AND table={name:String} ORDER BY position",query_params:{name},format:'JSONEachRow'});
        const actual=(await shape.json()).map(column=>{return `${column.name}:${column.type}`}).join(',');
        if(table.engine!==engine||table.sorting_key.replaceAll(' ','')!==key||table.partition_key!==partition||actual!==columns||(name!=='metrics_rejected_v3'&&!table.create_table_query.includes('ReplacingMergeTree(revision)'))){throw new Error('Incompatible central native storage schema');}
}

/** Atomic CREATE comments pin domain before any writer can activate. */
/* Schema DDL is deliberately ordered: pin and validate each table before views. */
/* eslint-disable no-await-in-loop */
export default async function nativeMetricsSchema(client,domain,relation,rawRelation) {
    if(!/^[a-f0-9]{64}$/u.test(domain)){throw new TypeError('Invalid central admission domain');}
    await client.command({query:'CREATE DATABASE IF NOT EXISTS scada'});
    const old=await client.query({query:"SELECT name FROM system.tables WHERE database='scada' AND name IN ('metrics_canonical','metrics_compact_v2')",format:'JSONEachRow'});
    if((await old.json()).length){throw new Error('Previous canonical storage requires an explicit v3 migration');}
    await client.command({query:LEGACY_METRICS_SQL});
    for(const table of tables){await installTable(client,domain,table);}
    for(const [name,sql] of [['metrics_read',relation],['metrics_raw_read',rawRelation]]){
        const found=await client.query({query:"SELECT engine,create_table_query FROM system.tables WHERE database='scada' AND name={name:String}",query_params:{name},format:'JSONEachRow'});
        const [view]=await found.json();
        if(view&&(view.engine!=='View'||!view.create_table_query.includes('metrics_points_v3'))){throw new Error('Previous canonical read view requires an explicit v3 migration');}
        await client.command({query:`CREATE VIEW IF NOT EXISTS scada.${name} AS SELECT * FROM ${sql}`});
    }
}

