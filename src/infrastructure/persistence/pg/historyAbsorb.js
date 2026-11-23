import historyFold from '../../../domain/segment/historyFold.js';

function span(segments) {
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
