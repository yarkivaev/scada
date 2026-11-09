import { rawMetricsRange } from './metricsRelation.js';

/** Actual observations for density-sensitive consumers; sealed thinning fails explicitly. */
export default async function clickhouseSamples(connection,topic,range,unit) {
    const rows=await connection.query(`SELECT ts,value FROM ${rawMetricsRange('{since:Int64}','{until:Int64}')}
        WHERE topic={topic:String} AND ts>=fromUnixTimestamp64Milli({since:Int64})
        AND ts<=fromUnixTimestamp64Milli({until:Int64}) ORDER BY ts`,
    {topic,since:range.start.getTime(),until:range.end.getTime()});
    return rows.map(row=>{return {timestamp:new Date(`${row.ts}Z`),value:row.value,unit};});
}
