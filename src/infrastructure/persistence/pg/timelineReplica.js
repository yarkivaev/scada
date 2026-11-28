const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const position = /^[1-9][0-9]{0,18}$/u;

export function decodeTimelineChange(body) {
    const change = body.timelineChange;
    if (!change || !['segment', 'segment-delete'].includes(body.type) || typeof body.machine !== 'string' ||
        !uuid.test(change.origin) || typeof change.position !== 'string' || !position.test(change.position) ||
        BigInt(change.position) > 9223372036854775807n || typeof change.kind !== 'string' || !change.kind ||
        typeof change.startTime !== 'string' || !Number.isFinite(Date.parse(change.startTime))) {
        throw new TypeError('Invalid timeline change');
    }
    const {row} = change;
    if (body.type === 'segment-delete' ? row !== null :
        (!row || row.machine !== body.machine || row.kind !== change.kind || row.start_time !== change.startTime ||
         typeof row.name !== 'string' || !Number.isFinite(Date.parse(row.end_time)) || !Number.isFinite(Date.parse(row.updated_at)))) {
        throw new TypeError('Invalid timeline change row');
    }
    return { machine: body.machine, type: body.type, timelineChange: change };
}

async function upsert(client, row) {
    const columns = 'machine,kind,name,start_time,end_time,duration,options,tags,properties,resolved,consumed,updated_at';
    await client.query(`INSERT INTO segments(${columns}) SELECT ${columns} FROM jsonb_populate_record(NULL::segments,$1::jsonb)
        ON CONFLICT(machine,kind,start_time) DO UPDATE SET name=EXCLUDED.name,end_time=EXCLUDED.end_time,
        duration=EXCLUDED.duration,options=EXCLUDED.options,tags=EXCLUDED.tags,properties=EXCLUDED.properties,
        resolved=EXCLUDED.resolved,consumed=EXCLUDED.consumed,updated_at=EXCLUDED.updated_at`,[JSON.stringify(row)]);
}

export default async function applyTimelineReplica(client, machine, {origin,position: sequence,kind,startTime,row}) {
    const key = [machine,kind,startTime];
    const claimed = await client.query(`INSERT INTO timeline_replica_positions(machine,kind,start_time,origin,position)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(machine,kind,start_time,origin)
        DO UPDATE SET position=EXCLUDED.position WHERE timeline_replica_positions.position < EXCLUDED.position`,
    [...key, origin, sequence]);
    if (!claimed.rowCount) { return false; }
    if (row) { await upsert(client,row); }
    else { await client.query('DELETE FROM segments WHERE machine=$1 AND kind=$2 AND start_time=$3',key); }
    return true;
}
