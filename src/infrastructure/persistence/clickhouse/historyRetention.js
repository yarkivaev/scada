import { sourceId } from './historySourceIdentity.js';

function coordinate(value) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) { throw new Error('Exact retention coordinate required'); }
    return number;
}
async function unseeded(pool) {
    const result = await pool.query(`SELECT 1 FROM history_work w JOIN history_classifiers k ON k.machine=w.machine
        WHERE NOT EXISTS(SELECT 1 FROM history_checkpoints c WHERE c.machine=w.machine AND c.classifier_key=k.classifier_key
            AND c.valid AND c.time_ms<COALESCE(w.cursor_ms,w.from_ms)) LIMIT 1`);
    return result.rowCount > 0;
}
async function watermark(pool, cutoff) {
    const result = await pool.query(`SELECT least($1::bigint,
        COALESCE((SELECT min(from_ms-86400000000) FROM history_work),$1),
        COALESCE((SELECT min(time_ms) FROM history_admissions),$1),
        COALESCE((SELECT min(seed.time_ms) FROM history_work w JOIN history_classifiers k ON k.machine=w.machine
            CROSS JOIN LATERAL (SELECT time_ms FROM history_checkpoints c WHERE c.machine=w.machine AND c.classifier_key=k.classifier_key
                AND c.valid AND c.time_ms<COALESCE(w.cursor_ms,w.from_ms) ORDER BY time_ms DESC LIMIT 1) seed),$1)) AS fence`, [cutoff]);
    return coordinate(result.rows[0].fence);
}
function compactCheckpoints(pool, fence) {
    return pool.query(`WITH ranked AS (
        SELECT c.machine,c.classifier_key,c.time_ms,row_number() OVER(PARTITION BY c.machine,c.classifier_key,c.valid,c.time_ms/COALESCE(t.bucket_ms,30000000) ORDER BY c.time_ms DESC) AS n
        FROM history_checkpoints c LEFT JOIN (SELECT machine,max(bucket_ms) AS bucket_ms FROM history_topics GROUP BY machine) t ON t.machine=c.machine
    ), protected AS (
        SELECT machine,classifier_key,max(time_ms) AS time_ms FROM history_checkpoints WHERE valid AND time_ms<$1 GROUP BY machine,classifier_key
        UNION SELECT c.machine,c.classifier_key,c.time_ms FROM history_work w JOIN history_classifiers k ON k.machine=w.machine
            CROSS JOIN LATERAL (SELECT machine,classifier_key,time_ms FROM history_checkpoints c WHERE c.machine=w.machine AND c.classifier_key=k.classifier_key
                AND c.valid AND c.time_ms<COALESCE(w.cursor_ms,w.from_ms) ORDER BY time_ms DESC LIMIT 1) c
    ) DELETE FROM history_checkpoints c USING ranked r
        WHERE c.machine=r.machine AND c.classifier_key=r.classifier_key AND c.time_ms=r.time_ms AND (r.n>1 OR c.time_ms<$1)
        AND NOT EXISTS(SELECT 1 FROM protected p WHERE p.machine=c.machine AND p.classifier_key=c.classifier_key AND p.time_ms=c.time_ms)`, [fence]);
}
async function pruneRaw(client, fence) {
    const result = await client.query({
        query: `SELECT topic,toUnixTimestamp64Micro(max(ts)) AS time FROM scada.metrics
            WHERE ts<fromUnixTimestamp64Micro({fence:Int64}) GROUP BY topic`,
        query_params: { fence }, format: 'JSONEachRow'
    });
    const anchors = (await result.json()).map(({ topic, time }) => { return `${Buffer.byteLength(topic)}:${topic}:${time}`; });
    await client.command({
        query: `ALTER TABLE scada.metrics DELETE WHERE ts<fromUnixTimestamp64Micro({fence:Int64})
            AND concat(toString(length(topic)),':',topic,':',toString(toUnixTimestamp64Micro(ts))) NOT IN {anchors:Array(String)}`,
        query_params: { fence, anchors }, clickhouse_settings: { mutations_sync: 1 }
    });
}
async function lockSources(pool) {
    await pool.query("SELECT pg_advisory_xact_lock(hashtextextended('history:configuration',0))");
    const machines = await pool.query('SELECT DISTINCT machine FROM history_topics ORDER BY machine');
    for (const { machine } of machines.rows) {
        // eslint-disable-next-line no-await-in-loop
        await pool.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`history:${machine}`]);
    }
}
async function transaction(pool, action) {
    const connection = await pool.connect();
    try {
        await connection.query('BEGIN');
        await connection.query("SET LOCAL statement_timeout = '20s'");
        await lockSources(connection);
        const result = await action(connection);
        await connection.query('COMMIT');
        return result;
    } catch (error) {
        await connection.query('ROLLBACK').catch(() => { return undefined; });
        throw error;
    } finally {
        connection.release();
    }
}
/** Persist a monotone raw-history floor BEFORE any independent ClickHouse command.
 * New registrations/late admissions respect this floor even after coordinator restart.
 * A delayed/repeated older mutation can therefore never delete a newly registered dependency.
 */
export default async function clickhouseHistoryRetention(client, pool, { retentionDays, now, ready }) {
    const fence = await transaction(pool, async (connection) => {
        await ready(connection);
        if (await unseeded(connection)) { return null; }
        const proposed = await watermark(connection, (now() - retentionDays * 86400000) * 1000);
        const result = await connection.query(`INSERT INTO history_retention(source_id,retained_from) VALUES($1,$2)
            ON CONFLICT(source_id) DO UPDATE SET retained_from=greatest(history_retention.retained_from,excluded.retained_from) RETURNING retained_from`, [sourceId, proposed]);
        return coordinate(result.rows[0].retained_from);
    });
    if (fence === null) { return { deferred: 'unseeded correction', checkpointsRemoved: 0 }; }
    await pruneRaw(client, fence);
    const compacted = await transaction(pool, async (connection) => {
        await connection.query('DELETE FROM history_corrections c USING history_work w WHERE c.work_id=w.id AND c.generation<>w.generation');
        await connection.query('DELETE FROM history_staged_checkpoints c USING history_work w WHERE c.work_id=w.id AND c.generation<>w.generation');
        return compactCheckpoints(connection, fence);
    });
    return { retainedFrom: fence, checkpointsRemoved: compacted.rowCount };
}
