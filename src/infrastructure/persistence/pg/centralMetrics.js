/* eslint-disable no-await-in-loop */
const INSERT = `WITH receipt AS (
    INSERT INTO central_metric_receipts(topic,ts_ms) VALUES($1,$2)
    ON CONFLICT DO NOTHING RETURNING topic,ts_ms
), bucket AS (
    INSERT INTO central_metric_buckets(topic,window_ms,bucket)
    SELECT topic,$4,$5 FROM receipt WHERE $4::bigint > 0
    ON CONFLICT DO NOTHING RETURNING topic
)
INSERT INTO central_metric_outbox(topic,ts_ms,value)
SELECT topic,ts_ms,$3 FROM receipt
WHERE $4::bigint = 0 OR EXISTS(SELECT 1 FROM bucket)`;

/** Reject invalid identity before storing any part of a batch. */
export function centralMetricPoint(record) {
    let ts = record.ts instanceof Date ? record.ts.getTime() : record.ts;
    if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(ts)) {
        const parsed = Date.parse(ts);
        if (Number.isFinite(parsed) && new Date(parsed).toISOString() === ts) { ts = parsed; }
    }
    if (typeof record.topic !== 'string' || !record.topic || record.topic.length > 1024
        || !Number.isSafeInteger(ts) || ts < -2208988800000 || ts > 10413791999999 || !Number.isFinite(record.value)) {
        throw new TypeError('Central telemetry requires a logical topic, original millisecond timestamp and finite value');
    }
    return { topic: record.topic, ts, value: record.value };
}

async function transaction(pool, action) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await action(client);
        await client.query('COMMIT');
        return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
}

async function accept(client, points, policy) {
    // Serialize capacity checks across receivers, not just within one process.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('central_metric_capacity',0))");
    for (const point of points) {
        const window = policy.forTopic(point.topic).thinWindowMs;
        await client.query(INSERT, [point.topic, point.ts, point.value, window, window ? Math.floor(point.ts / window) : 0]);
    }
    const count = await client.query('SELECT count(*)::integer AS count FROM central_metric_outbox');
    if (count.rows[0].count > policy.maxPendingRecords) { throw new Error('Central telemetry pending capacity exceeded'); }
}

/** Durable first-wins decisions, including rejected thinning candidates, plus a projection outbox. */
export default function centralMetricsPg(pool, policy) {
    return {
        write(records) {
            const points = records.map(centralMetricPoint);
            return transaction(pool, (client) => { return accept(client, points, policy); });
        },
        project(sink) {
            return transaction(pool, async (client) => {
                const result = await client.query(`SELECT topic,ts_ms,value FROM central_metric_outbox
                    ORDER BY seq LIMIT $1 FOR UPDATE SKIP LOCKED`, [policy.batchSize]);
                if (!result.rows.length) { return 0; }
                await sink.write(result.rows.map((row) => { return { topic: row.topic, ts: Number(row.ts_ms), value: row.value }; }));
                for (const row of result.rows) {
                    await client.query('DELETE FROM central_metric_outbox WHERE topic=$1 AND ts_ms=$2', [row.topic, row.ts_ms]);
                }
                return result.rows.length;
            });
        }
    };
}
