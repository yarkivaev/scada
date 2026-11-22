import { createHash } from 'node:crypto';

function closedContinuity(rows, until) {
    return (rows ?? []).flatMap((row) => {
        const from = Number(row.from);
        if (from > until) { return []; }
        return [{ from, until: Math.min(Number(row.until), until) }];
    });
}
function frozen(until, timeScale, row) {
    if (!row?.end_time) { return row; }
    const edge = new Date(row.end_time).getTime() * timeScale;
    if (edge <= until) { return row; }
    return { ...row, end_time: new Date(until / timeScale) };
}

/**
 * Closed-page identity. Observations after until cannot change the claim.
 *
 * {{{
 * historyRevision({ items, segments, annotations, continuity }, until, timeScale)
 * }}}
 */
export default function historyRevision(snapshot, until, timeScale = 1) {
    if (!Number.isSafeInteger(until)) { throw new TypeError('Closed history until required'); }
    const items = (snapshot.items ?? []).filter((row) => { return Number(row.time) <= until; });
    return createHash('sha256').update(JSON.stringify({
        initial: snapshot.initial,
        annotations: (snapshot.annotations ?? []).map((row) => { return frozen(until, timeScale, row); }),
        segments: (snapshot.segments ?? []).map((row) => { return frozen(until, timeScale, row); }),
        items,
        continuity: closedContinuity(snapshot.continuity, until)
    })).digest('hex');
}
