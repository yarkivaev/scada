import insertMetricRows from './insertMetricRows.js';

function datetime(value) {
    if (value instanceof Date) { return value.toISOString().replace('T', ' ').replace(/Z$/u, ''); }
    if (typeof value === 'number') { return datetime(new Date(value)); }
    return value.replace('T', ' ').replace(/Z$/u, '');
}
function instant(value) { return new Date(`${String(value).replace(' ', 'T')}Z`); }
function samples(rows) {
    return rows.map(row => {
        return { ...row, ts: instant(row.ts), value: Number(row.value), ...(row.until ? { until: instant(row.until) } : {}) };
    });
}
function canonical() {
    return 'SELECT topic,ts,max(value) AS value FROM scada.metrics WHERE topic={topic:String} GROUP BY topic,ts';
}
function lookup(condition = '') {
    return `SELECT ts,max(value) AS value FROM scada.metrics WHERE topic={topic:String}${condition}
        AND ts=(SELECT ts FROM scada.metrics WHERE topic={topic:String}${condition} ORDER BY ts DESC LIMIT 1) GROUP BY ts`;
}
async function query(client, sql, params) {
    const response = await client.query({ query: sql, query_params: params, format: 'JSONEachRow' });
    return response.json();
}
function parameters(topic, start, end) { return { topic, start: datetime(start), end: datetime(end) }; }
function levels() {
    return `WITH canonical AS (${canonical()}), prior AS (
        ${lookup(" AND ts < {start:DateTime64(6,'UTC')}")}
    ), series AS (
        SELECT ts,value FROM prior UNION ALL
        SELECT ts,value FROM canonical WHERE ts >= {start:DateTime64(6,'UTC')} AND ts <= {end:DateTime64(6,'UTC')}
    ), marked AS (
        SELECT ts,value,row_number() OVER(ORDER BY ts) AS n,
        lagInFrame(toNullable(value),1) OVER(ORDER BY ts ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS prev
        FROM series
    )`;
}

function timeSeries(client) {
    return {
        async rangeForTopic(topic, start, end, step) {
            const rows = await query(client, `SELECT toStartOfInterval(ts,INTERVAL {step:UInt32} SECOND) AS bucket,argMax(value,ts) AS value
                FROM (${canonical()}) WHERE ts >= {start:DateTime64(6,'UTC')} AND ts <= {end:DateTime64(6,'UTC')}
                GROUP BY bucket ORDER BY bucket`, { ...parameters(topic, start, end), step: Math.max(1, Math.floor(step / 1000)) });
            return samples(rows.map(({ bucket, value }) => { return { ts: bucket, value }; }));
        },
        async risesForTopic(topic, start, end) {
            const rows = await query(client, `${levels()}
                SELECT ts,sum(1) OVER(ORDER BY ts) AS prefix FROM marked
                WHERE ts >= {start:DateTime64(6,'UTC')} AND ts < {end:DateTime64(6,'UTC')} AND prev=0 AND value=1 ORDER BY ts`, parameters(topic, start, end));
            return samples(rows.map(({ ts, prefix }) => { return { ts, value: prefix }; }));
        },
        async changesForTopic(topic, start, end) {
            return samples(await query(client, `${levels()}
                SELECT if(ts < {start:DateTime64(6,'UTC')},{start:DateTime64(6,'UTC')},ts) AS ts,value
                FROM marked WHERE n=1 OR value != prev ORDER BY ts`, parameters(topic, start, end)));
        },
        async holdsForTopic(topic, start, end, step) {
            const sql = `WITH canonical AS (${canonical()}), lagged AS (
                SELECT ts,value,lagInFrame(ts,1) OVER(ORDER BY ts) AS previous,
                lagInFrame(toNullable(value),1) OVER(ORDER BY ts) AS prev
                FROM canonical WHERE ts >= {start:DateTime64(6,'UTC')} AND ts < {end:DateTime64(6,'UTC')}
            ), grouped AS (
                SELECT ts,value,sum(if(prev IS NULL OR value != prev OR toUnixTimestamp64Micro(ts)-toUnixTimestamp64Micro(previous) > {gap:UInt64},1,0)) OVER(ORDER BY ts) AS grp FROM lagged
            ) SELECT min(ts) AS started,max(ts) AS until,min(value) AS value FROM grouped GROUP BY grp ORDER BY started`;
            const rows = await query(client, sql, { ...parameters(topic, start, end), gap: Math.max(1, Number(step) || 1000) * 1000 });
            return samples(rows.map(({ started, until, value }) => { return { ts: started, until, value }; }));
        }
    };
}

/** ClickHouse state for telemetry graphs and checkpoint readings over canonical samples. */
export default function clickhouseMetricsState(client, { readingsTable = 'metrics' } = {}) {
    return {
        ...timeSeries(client),
        async latestForTopic(topic) {
            return samples(await query(client, lookup(), { topic }))[0] ?? null;
        },
        async pollTopic(topic, after, until) {
            return samples(await query(client, `SELECT ts,value FROM (${canonical()})
                WHERE ts > {start:DateTime64(6,'UTC')} AND ts <= {end:DateTime64(6,'UTC')} ORDER BY ts LIMIT 100`, parameters(topic, after, until)));
        },
        async readings(topics, from) {
            if (topics.length === 0) { return []; }
            const rows = await query(client, `SELECT topic,toUnixTimestamp64Micro(ts) AS instant,max(value) AS value
                FROM scada.{source:Identifier} WHERE topic IN {topics:Array(String)} AND ts > fromUnixTimestamp64Micro({from:Int64})
                GROUP BY topic,ts ORDER BY ts,topic`, { source: readingsTable, topics, from: Math.round(from * 1000000) });
            return rows.map(row => { return { topic: row.topic, timestamp: Number(row.instant) / 1000000, value: Number(row.value) }; });
        },
        insertRows(rows, context) { return insertMetricRows(client, rows, context); }
    };
}
