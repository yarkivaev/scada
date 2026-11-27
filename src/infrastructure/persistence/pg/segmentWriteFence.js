import { createHash } from 'node:crypto';

function conflict(writeCode, message) {
    return Object.assign(new Error(message), {statusCode: 409, writeCode, permanent: true});
}

function stableJson(value) {
    if (value instanceof Date) { return value.toJSON(); }
    if (Array.isArray(value)) { return value.map(stableJson); }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => { return [key, stableJson(value[key])]; }));
    }
    return value;
}

export function writeFence(input) {
    if (!input || typeof input.outputId !== 'string' || !input.outputId || input.outputId.length > 512 ||
        (input.generation !== undefined && (!Number.isSafeInteger(input.generation) || input.generation < 1))) {
        throw new TypeError('A segment write requires an output ID and a valid generation when supplied');
    }
    return input;
}

export async function activeSegmentLease(client,machine) {
    const {rows:[active]} = await client.query(
        `SELECT pid FROM pg_locks
         WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
           AND classid=hashtext('scada-classify')::oid AND objid=hashtext($1)::oid
           AND objsubid=2 AND mode='ExclusiveLock' AND granted`, [machine]);
    return active;
}

export async function segmentLeaseMatches(client, machine, generation) {
    // The placeholder serializes an unleased write with the first grant for this machine.
    await client.query('INSERT INTO classifier_generation(machine,generation) VALUES($1,0) ON CONFLICT DO NOTHING', [machine]);
    const {rows:[owner]} = await client.query('SELECT generation,holder_pid FROM classifier_generation WHERE machine=$1 FOR SHARE', [machine]);
    const active = await activeSegmentLease(client,machine);
    return generation === undefined
        ? !active
        : Boolean(active && active.pid === owner.holder_pid && String(owner.generation) === String(generation));
}

function digest(body) {
    return createHash('sha256').update(JSON.stringify(stableJson(body))).digest('hex');
}

export async function writeReceipt(client, machine, outputId, body) {
    const {rows:[prior]} = await client.query(
        'SELECT fingerprint,outcome FROM segment_write_receipts WHERE machine=$1 AND output_id=$2',
        [machine,outputId]);
    if (prior && prior.fingerprint !== digest(body)) {
        throw conflict('OUTPUT_CONFLICT', 'Output ID already identifies a different segment write');
    }
    return prior?.outcome;
}

export function storeWriteReceipt(client,machine,outputId,body,outcome) {
    return client.query('INSERT INTO segment_write_receipts VALUES($1,$2,$3,$4::jsonb)',
        [machine,outputId,digest(body),JSON.stringify(outcome)]);
}

/** Uses the caller's transaction, serialized on its machine, for the receipt and authoritative write. */
export default async function writeFencedSegment(client, machine, input, body, apply) {
    const fence = writeFence(input);
    const prior = await writeReceipt(client,machine,fence.outputId,body);
    if (prior) { return prior; }
    if (!await segmentLeaseMatches(client,machine,fence.generation)) {
        throw conflict('STALE_OWNER', 'Classifier no longer holds the generation');
    }
    const outcome = await apply();
    if (outcome.applied) {
        await storeWriteReceipt(client,machine,fence.outputId,body,outcome);
    }
    return outcome;
}

export function historyWriteFence(client,machine,{base,workId,segments},apply) {
    if (!base || !Object.hasOwn(base,'fence')) { return apply(); }
    const {fence,...context} = base;
    if (typeof context.revision !== 'string' || !context.revision) {
        throw new TypeError('History context revision required');
    }
    return writeFencedSegment(client,machine,fence,{workId,segments,context},apply);
}

export async function segmentRevision(client, machine) {
    const result = await client.query('SELECT revision::text FROM segment_timeline_revisions WHERE machine=$1', [machine]);
    return {revision: result.rows[0]?.revision ?? '0'};
}

export async function checkSegmentRevision(client, machine, expected) {
    await client.query('LOCK TABLE segments, contiguous_phase_inbox IN SHARE ROW EXCLUSIVE MODE');
    const {revision} = await segmentRevision(client, machine);
    if (revision !== expected) { throw conflict('REVISION_CONFLICT', 'Segment timeline revision changed'); }
}

export async function serialSegmentTransaction(pool, machine, apply, timeoutMs = 10000) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('statement_timeout',$1,true)",[String(timeoutMs)]);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`history:${machine}`]);
        const result = await apply(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
