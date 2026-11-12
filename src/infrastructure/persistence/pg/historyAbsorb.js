function mark(item) {
    return typeof item.tags === 'string' ? item.tags : JSON.stringify(item.tags ?? null);
}

/** Drop same-name same-tag starts strictly inside a segment this commit already covers. */
export default async function historyAbsorb(client, machine, segments) {
    const covered = segments.filter((item) => { return item.start_time && item.end_time && item.name; }).map((item) => {
        return { name: item.name, start_time: item.start_time, end_time: item.end_time, tags: mark(item) };
    });
    if (!covered.length) { return 0; }
    const removed = await client.query(`DELETE FROM segments AS stored WHERE stored.machine=$1 AND stored.kind='phase' AND EXISTS (
        SELECT 1 FROM json_array_elements($2::json) AS item
        WHERE stored.name=item->>'name'
          AND stored.start_time > (item->>'start_time')::timestamptz
          AND stored.start_time < (item->>'end_time')::timestamptz
          AND coalesce(stored.tags,'') = coalesce(item->>'tags',''))`, [machine, JSON.stringify(covered)]);
    return removed.rowCount;
}
