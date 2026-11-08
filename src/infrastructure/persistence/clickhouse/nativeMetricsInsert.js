import {Readable} from 'node:stream';

function lengthPrefix(length) {
    const bytes=[];let remaining=length;
    do{const digit=remaining%128;remaining=Math.floor(remaining/128);bytes.push(digit+(remaining?128:0));}while(remaining);
    return Buffer.from(bytes);
}
function scalar(value,method,size) {
    const buffer=Buffer.alloc(size);buffer[method](value);return buffer;
}
function revision(value) {
    const number=BigInt(value);const base=2n**64n;
    return Buffer.concat([scalar(number%base,'writeBigUInt64LE',8),scalar(number/base,'writeBigUInt64LE',8)]);
}
function record(row) {
    if(!Number.isFinite(row.value)){throw new TypeError('Finite central telemetry value required');}
    const topic=Buffer.from(row.topic,'utf8');
    return Buffer.concat([lengthPrefix(topic.length),topic,
        scalar(BigInt(Date.parse(`${row.ts.replace(' ','T')}Z`)),'writeBigInt64LE',8),
        scalar(row.value,'writeDoubleLE',8),scalar(BigInt(row.compact_ms),'writeBigUInt64LE',8),revision(row.revision),
        scalar(row.is_compacted??0,'writeUInt8',1),
        ...['compact_first','compact_last','compacted_at'].map(field=>{return scalar(BigInt(row[field]??0),'writeBigInt64LE',8);})]);
}
/** Preserve Float64 bits and UInt128 revisions for admission and endpoint publication. */
export default async function nativeMetricsInsert(client,rows) {
    if(!rows.length){return;}
    const response=await client.exec({query:'INSERT INTO scada.metrics_points_v3 (topic,ts,value,compact_ms,revision,is_compacted,compact_first,compact_last,compacted_at) FORMAT RowBinary',
        values:Readable.from([Buffer.concat(rows.map(record))],{objectMode:false}),
        clickhouse_settings:{async_insert:0,wait_for_async_insert:1,wait_end_of_query:1}});
    for await(const chunk of response.stream){if(chunk.length){throw new Error('Unexpected ClickHouse central insertion response');}}
}
