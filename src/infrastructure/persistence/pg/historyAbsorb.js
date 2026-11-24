import historyFold from '../../../domain/segment/historyFold.js';

export function span(segments) {
    return segments.reduce((range, item) => {
        return {
            start: Math.min(range.start, new Date(item.start_time).getTime()),
            end: Math.max(range.end, new Date(item.end_time).getTime())
        };
    }, { start: Infinity, end: -Infinity });
}

function startOf(row) {
    return new Date(row.start_time).getTime();
}

/** Fold later stream phases into stored rows, then drop absorbed starts. */
export default async function historyAbsorb(client, machine, segments) {
    if (!segments.length) {
        return [];
    }
    const range = span(segments);
    const stored = await client.query(
        `SELECT kind,name,start_time,end_time,duration,options,tags,properties,resolved,consumed
         FROM segments WHERE machine=$1 AND kind='phase' AND start_time<$3 AND end_time>$2`,
        [machine, new Date(range.start), new Date(range.end)]
    );
    const folded = historyFold(stored.rows, segments);
    const kept = new Set(folded.map(startOf));
    const dropped = stored.rows.filter((row) => {
        return !kept.has(startOf(row));
    });
    if (dropped.length) {
        await client.query(
            'DELETE FROM segments WHERE machine=$1 AND kind=\'phase\' AND start_time = ANY($2::timestamptz[])',
            [machine, dropped.map((row) => { return row.start_time; })]
        );
    }
    return folded;
}

/** Drops later unsplit same-tag starts that landed inside an earlier host. */
export async function historyDedupe(client, machine, range) {
    const bounds = [machine, new Date(range.start), new Date(range.end)];
    await client.query(
        `UPDATE segments AS host
         SET end_time = extra.end_time,
             duration = CASE WHEN host.duration = 0 THEN 0
                             ELSE extract(epoch FROM extra.end_time - host.start_time) END,
             updated_at = clock_timestamp()
         FROM segments AS extra
         WHERE host.machine = $1 AND extra.machine = $1
           AND host.kind = 'phase' AND extra.kind = 'phase'
           AND host.name = extra.name
           AND coalesce(host.tags, '') = coalesce(extra.tags, '')
           AND coalesce(host.properties, '') NOT LIKE '%"split_of"%'
           AND coalesce(extra.properties, '') NOT LIKE '%"split_of"%'
           AND extra.start_time > host.start_time
           AND extra.start_time < host.end_time
           AND extra.end_time > host.end_time
           AND extra.start_time < $3 AND extra.end_time > $2`,
        bounds
    );
    await client.query(
        `DELETE FROM segments AS extra
         USING segments AS host
         WHERE extra.machine = $1 AND host.machine = $1
           AND extra.kind = 'phase' AND host.kind = 'phase'
           AND extra.name = host.name
           AND coalesce(extra.tags, '') = coalesce(host.tags, '')
           AND coalesce(extra.properties, '') NOT LIKE '%"split_of"%'
           AND coalesce(host.properties, '') NOT LIKE '%"split_of"%'
           AND extra.start_time > host.start_time
           AND extra.start_time < host.end_time
           AND extra.start_time < $3 AND extra.end_time > $2`,
        bounds
    );
}
