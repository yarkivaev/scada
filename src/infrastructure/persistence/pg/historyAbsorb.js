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

function windows(segments) {
    const ordered = segments.map((item) => {
        return { start: new Date(item.start_time).getTime(), end: new Date(item.end_time).getTime() };
    }).sort((left, right) => { return left.start - right.start; });
    return ordered.reduce((merged, range) => {
        const last = merged.at(-1);
        if (!last || range.start >= last.end) {
            merged.push({ ...range });
            return merged;
        }
        last.end = Math.max(last.end, range.end);
        return merged;
    }, []);
}

/** Fold later stream phases into stored rows, then drop absorbed starts. */
export default async function historyAbsorb(client, machine, segments) {
    if (!segments.length) {
        return [];
    }
    const pieces = windows(segments);
    const starts = pieces.map((piece) => { return new Date(piece.start); });
    const ends = pieces.map((piece) => { return new Date(piece.end); });
    const stored = await client.query(
        `SELECT DISTINCT ON (start_time) machine,kind,name,start_time,end_time,duration,options,tags,properties,resolved,consumed
         FROM (
           SELECT s.machine,s.kind,s.name,s.start_time,s.end_time,s.duration,s.options,s.tags,s.properties,s.resolved,s.consumed
           FROM unnest($2::timestamptz[], $3::timestamptz[]) AS piece(start_time, end_time)
           JOIN LATERAL (
             SELECT * FROM segments
             WHERE machine=$1 AND kind='phase' AND start_time <= piece.start_time
             ORDER BY start_time DESC
             LIMIT 1
           ) s ON s.end_time > piece.start_time
           UNION ALL
           SELECT s.machine,s.kind,s.name,s.start_time,s.end_time,s.duration,s.options,s.tags,s.properties,s.resolved,s.consumed
           FROM segments AS s
           JOIN unnest($2::timestamptz[], $3::timestamptz[]) AS piece(start_time, end_time)
             ON s.start_time > piece.start_time AND s.start_time < piece.end_time
           WHERE s.machine=$1 AND s.kind='phase'
           UNION ALL
           SELECT s.machine,s.kind,s.name,s.start_time,s.end_time,s.duration,s.options,s.tags,s.properties,s.resolved,s.consumed
           FROM segments AS s
           JOIN unnest($2::timestamptz[], $3::timestamptz[]) AS piece(start_time, end_time)
             ON s.start_time <= piece.start_time
           WHERE s.machine=$1 AND s.kind='phase' AND s.duration = 0
         ) hit
         ORDER BY start_time`,
        [machine, starts, ends]
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
