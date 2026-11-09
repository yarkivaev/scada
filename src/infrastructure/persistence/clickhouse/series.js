import { chartMetricsRange } from './metricsRelation.js';

function seriesPoints(rows,unit) {
    const result=[];
    let prior;
    for (const row of rows) {
        const timestamp=new Date(`${row.ts}Z`);
        const separated=prior && row.segment!==undefined && String(row.segment)!==String(prior.segment);
        if(separated && timestamp.getTime()-prior.timestamp.getTime()>1 && prior.value!==null && row.value!==null) {
            result.push({timestamp:new Date(Math.floor((prior.timestamp.getTime()+timestamp.getTime())/2)),value:null,unit});
        }
        const point={timestamp,value:row.value,unit};
        if(Number(row.native)===1) {point.continuous=Boolean(prior && !separated && prior.value!==null && row.value!==null);}
        result.push(point);
        prior={...row,timestamp};
    }
    return result;
}

/** Coarse buckets retain actual island boundaries, including subsecond timestamps. */
export default async function clickhouseSeries(connection, topic, range, step, unit) {
    const seconds = Math.max(1, Math.floor(step / 1000));
    const start = range.start.toISOString().replace('Z', '').replace('T', ' ');
    const end = range.end.toISOString().replace('Z', '').replace('T', ' ');
    const rows = await connection.query(
        `WITH points AS (
            SELECT * FROM ${chartMetricsRange('toUnixTimestamp64Milli({start:DateTime64(3)})','toUnixTimestamp64Milli({end:DateTime64(3)})')}
            WHERE topic={topic:String} AND ts>={start:DateTime64(3)} AND ts<={end:DateTime64(3)}
        ), prior AS (
            SELECT *,row_number() OVER (ORDER BY ts) AS ordinal,
                lagInFrame(coverage_last_ms,1) OVER (ORDER BY ts) AS prior_last,
                lagInFrame(max_gap_ms,1) OVER (ORDER BY ts) AS prior_gap,
                lagInFrame(native,1) OVER (ORDER BY ts) AS prior_native FROM points
        ), segmented AS (
            SELECT *,sum(toUInt8(ordinal=1 OR native!=prior_native OR max_gap_ms!=prior_gap OR max_gap_ms=0
                OR coverage_first_ms>prior_last+toInt64(max_gap_ms))) OVER (ORDER BY ts) AS segment FROM prior
        ), buckets AS (
            SELECT segment,native,toStartOfInterval(ts,INTERVAL ${seconds} SECOND) AS bucket,
                min(ts) AS first_ts,max(ts) AS last_ts,argMin(value,ts) AS first_value,argMax(value,ts) AS last_value
            FROM segmented GROUP BY segment,native,bucket
        ) SELECT tupleElement(vertex,1) AS ts,tupleElement(vertex,2) AS value,segment,native
        FROM (SELECT segment,native,arrayJoin(arrayDistinct([tuple(first_ts,first_value),tuple(last_ts,last_value)])) AS vertex FROM buckets)
        ORDER BY ts`,
        { topic, start, end }
    );
    return seriesPoints(rows,unit);
}
