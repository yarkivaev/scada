/** An opted-in track advances only from its certified anchor or its current visible tail. */
export function phaseAnchors(raw) {
    if (raw === undefined) {
        return new Map();
    }
    const values = JSON.parse(raw);
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
        throw new TypeError('CONTIGUOUS_PHASE_ANCHORS must map machine ids to UTC timestamps');
    }
    return new Map(Object.entries(values).map(([machine, value]) => {
        if (!machine || typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*Z$/u.test(value) || !Number.isFinite(Date.parse(value))) {
            throw new TypeError('Invalid contiguous phase anchor');
        }
        return [machine, new Date(value).toISOString()];
    }));
}

const stage = `
    INSERT INTO contiguous_phase_inbox (machine, start_time, phase)
    VALUES ($1,$2,$3)
    ON CONFLICT (machine, start_time) DO UPDATE SET phase=EXCLUDED.phase
    WHERE (contiguous_phase_inbox.phase->>'duration')::numeric = 0
      AND ((EXCLUDED.phase->>'duration')::numeric > 0
           OR (EXCLUDED.phase->>'end_time')::timestamptz >=
              (contiguous_phase_inbox.phase->>'end_time')::timestamptz)`;

const visible = `
    INSERT INTO segments (machine,kind,name,start_time,end_time,duration,options,tags,properties,resolved,updated_at)
    VALUES ($1,'phase',$2,$3,$4,$5,$6,$7,$8,$9,now())
    ON CONFLICT (machine,kind,start_time) DO UPDATE SET
        name=EXCLUDED.name,end_time=EXCLUDED.end_time,duration=EXCLUDED.duration,
        options=EXCLUDED.options,properties=EXCLUDED.properties,updated_at=EXCLUDED.updated_at
    WHERE segments.duration=0
      AND (EXCLUDED.duration>0 OR
           ((segments.name=EXCLUDED.name OR segments.start_time=segments.end_time)
             AND segments.end_time<=EXCLUDED.end_time))`;

function invalid(message) {
    return Object.assign(new RangeError(message), { permanent: true });
}

function check(row) {
    const span = Date.parse(row.end_time) - Date.parse(row.start_time);
    if (!Number.isSafeInteger(span) || span < 0 ||
        (row.duration !== 0 && (span === 0 || row.duration !== span / 1000))) {
        throw invalid('Invalid phase duration or bounds');
    }
}

function write(runner, row) {
    return runner.query(visible, [row.machine,row.name,row.start_time,row.end_time,row.duration,
        row.options ?? null,row.tags ?? null,row.properties ?? null,row.resolved ?? true]);
}

async function drain(runner, machine, start) {
    let next = start;
    for (;;) {
        // Rows ahead of the tail survive in the inbox until the preceding phase commits.
        // eslint-disable-next-line no-await-in-loop
        const { rows: [item] } = await runner.query(
            'DELETE FROM contiguous_phase_inbox WHERE machine=$1 AND start_time=$2 RETURNING phase',
            [machine,next]);
        if (!item) {
            return;
        }
        // eslint-disable-next-line no-await-in-loop
        await write(runner, item.phase);
        if (item.phase.duration === 0) {
            return;
        }
        next = item.phase.end_time;
    }
}

async function commit(runner, row, anchor) {
    check(row);
    const { machine } = row;
    await runner.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`history:${machine}`]);
    const { rows: [latest] } = await runner.query(`
        SELECT start_time, end_time, duration FROM segments
        WHERE machine=$1 AND kind='phase' AND start_time >= $2
        ORDER BY start_time DESC LIMIT 1`, [machine, anchor]);
    let next = anchor;
    if (latest) {
        next = Number(latest.duration) > 0 ? latest.end_time : latest.start_time;
    }
    if (Date.parse(row.start_time) >= Date.parse(next)) {
        await runner.query(stage, [machine, row.start_time, JSON.stringify(row)]);
        await drain(runner, machine, next);
    }
}

function apply(runner, rows, anchor) {
    return rows.reduce(async (previous, row) => {
        await previous;
        await commit(runner, row, anchor);
    }, Promise.resolve());
}

async function transaction(pool, rows, anchor) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await apply(client, rows, anchor);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/** Adds durable out-of-order staging for explicitly anchored phase tracks. */
export default function contiguousPhases(pool, anchors, dispatch) {
    if (!anchors?.size) {
        return dispatch;
    }
    function routed(row) {
        return anchors.has(row.machine) && (row.kind ?? 'phase') === 'phase' &&
            ['segment', 'split', 'split-family', 'phase-transition'].includes(row.type);
    }
    function accept(row, client) {
        if (!routed(row)) {
            return dispatch.accept(row, client);
        }
        if (row.type === 'split-family') {
            throw invalid('An anchored phase track cannot change geometry via split-family');
        }
        if (row.type === 'split') {
            // Casting publishers send a compatibility split before each authoritative segment.
            return Promise.resolve();
        }
        const anchor = anchors.get(row.machine);
        const rows = row.type === 'phase-transition' ? row.pieces : [row];
        return client ? apply(client, rows, anchor) : transaction(pool, rows, anchor);
    }
    return {
        accept,
        acceptMany(records, client) {
            if (!records.some(routed)) {
                return dispatch.acceptMany(records, client);
            }
            return records.reduce(async (pending, row) => {
                await pending;
                return accept(row, client);
            }, Promise.resolve());
        }
    };
}

/** Refuse to adopt an existing noncontiguous suffix as a certified prefix. */
export async function validatePhaseAnchors(pool, anchors = new Map()) {
    for (const [machine, anchor] of anchors) {
        // eslint-disable-next-line no-await-in-loop
        const { rows: [status] } = await pool.query(`
            WITH suffix AS (
                SELECT start_time,end_time,duration,
                  lag(end_time,1,$2::timestamptz) OVER (ORDER BY start_time) AS expected,
                  lead(start_time) OVER (ORDER BY start_time) AS next
                FROM segments WHERE machine=$1 AND kind='phase' AND start_time >= $2
            )
            SELECT EXISTS (SELECT 1 FROM suffix WHERE start_time<>expected OR end_time<start_time
                  OR (duration=0 AND next IS NOT NULL)) OR EXISTS (
                SELECT 1 FROM segments WHERE machine=$1 AND kind='phase' AND start_time<$2 AND end_time>$2
            ) AS invalid`, [machine,anchor]);
        if (status.invalid) {
            throw new Error(`Cannot adopt noncontiguous phase history for ${machine}`);
        }
    }
}
