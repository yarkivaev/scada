export function historyReplication(value) {
    if (!value || typeof value.exchange !== 'string' || !/^[\w.-]{1,255}$/u.test(value.exchange) ||
        typeof value.routingKey !== 'string' || Buffer.byteLength(value.routingKey) > 255 ||
        (value.epoch !== undefined && (!Number.isSafeInteger(value.epoch) || value.epoch < 1))) {
        throw new TypeError('Invalid history replication destination or epoch');
    }
    return value;
}

function metadata(value, expected) {
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (Array.isArray(parsed)) {
            const strings = parsed.filter(item => { return typeof item === 'string'; });
            return expected === 'array' && strings.length ? strings : null;
        }
        if (expected !== 'object' || !parsed || typeof parsed !== 'object') { return null; }
        const entries = Object.entries(parsed).filter(([, item]) => { return typeof item === 'string'; });
        return entries.length ? Object.fromEntries(entries) : null;
    } catch { return null; }
}

function envelope({machine, segment: row, output_id: committedOutputId, epoch}) {
    const tags = metadata(row.tags, 'array');
    return JSON.stringify({
        type: 'segment', kind: row.kind ?? 'phase', machine, name: row.name,
        start: new Date(row.start_time).getTime(), end: new Date(row.end_time).getTime(),
        duration: row.duration ?? 0, status: row.duration ? 'completed' : 'pending', tags,
        options: metadata(row.options, 'array'), properties: metadata(row.properties, 'object'),
        ...(tags && { resolved: true }), ...(epoch !== null && { epoch: Number(epoch) }), committedOutputId
    });
}

export async function enableHistoryReplicaCapture(client, machine, fence, replication) {
    const { exchange, routingKey, epoch } = historyReplication(replication);
    if (fence.generation !== undefined && epoch !== fence.generation) {
        throw new TypeError('History replication epoch must match the writer generation');
    }
    const setting = JSON.stringify({ machine, outputId: fence.outputId, exchange, routingKey, epoch });
    await client.query("SELECT set_config('scada.history_replica',$1,true)", [setting]);
}

async function deliver(client, row, publish, retryMs) {
    try {
        await publish({
            exchange: row.exchange, routingKey: row.routing_key, body: envelope(row),
            options: { persistent: true, mandatory: true, contentType: 'application/json' }
        });
    } catch (error) {
        // Commit only the retry schedule. A hard crash rolls it back and leaves the same payload.
        await client.query("UPDATE history_replica_outbox SET retry_at=clock_timestamp()+$2*interval '1 millisecond' WHERE id=$1",
            [row.id, retryMs]);
        return error;
    }
    await client.query('DELETE FROM history_replica_outbox WHERE id=$1', [row.id]);
    return null;
}

/** One broker confirm per transaction. A machine's later entries wait behind its head. */
export async function deliverHistoryReplica(pool, publish, retryMs = 1000) {
    const client = await pool.connect();
    let failure;
    let delivered;
    try {
        await client.query('BEGIN');
        const { rows: [row] } = await client.query(`SELECT queued.id,queued.machine,queued.exchange,queued.routing_key,queued.output_id,queued.epoch,queued.segment
            FROM history_replica_outbox queued WHERE queued.retry_at <= clock_timestamp()
            AND NOT EXISTS (SELECT 1 FROM history_replica_outbox prior WHERE prior.machine=queued.machine AND prior.id<queued.id)
            ORDER BY queued.id LIMIT 1 FOR UPDATE OF queued SKIP LOCKED`);
        failure = row ? await deliver(client, row, publish, retryMs) : null;
        delivered = Boolean(row);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
    return { found: delivered, error: failure };
}
