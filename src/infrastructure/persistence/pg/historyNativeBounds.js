export const nativeTailProtocol = 'preserve-known-suffix-v1';
function instant(value) { return new Date(value).getTime(); }
function kind(row) { return row.kind ?? 'phase'; }
function identity(left, right) {
    return kind(left) === kind(right) && left.name === right.name
        && instant(left.start_time) === instant(right.start_time) && instant(left.end_time) === instant(right.end_time);
}
function provedOwner(item, latest, base, until) {
    const start = instant(item.start_time); const end = instant(item.end_time);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) { throw new TypeError('Invalid bounded history segment'); }
    if (end <= until) { return null; }
    const owner = base.nativeTailMode === nativeTailProtocol && (latest.segments ?? []).find(row => {
        return item.preserveSuffix && identity(row, item.preserveSuffix)
            && kind(row) === kind(item) && row.name === item.name
            && instant(row.start_time) <= until && instant(row.start_time) <= start
            && start <= until + 1 && instant(row.end_time) === end;
    });
    if (!owner) { throw new TypeError('Segment extends beyond bounded history page without a current suffix proof'); }
    return owner;
}
function retainExterior(segments, current, owners, until) {
    for (const owner of current) {
        const change = segments.find(item => { return kind(item) === kind(owner) && instant(item.start_time) === instant(owner.start_time); });
        if (change && instant(owner.end_time) > until
            && (change.name !== owner.name || instant(change.end_time) < instant(owner.end_time))) {
            const retained = [...owners].some(([item, proof]) => {
                return identity(proof, owner) && instant(item.start_time) <= until + 1;
            });
            if (!retained) { throw new TypeError('Known history tail would be truncated; upgrade the history worker'); }
        }
    }
}
/** A bounded native correction may carry existing exterior, never classify new exterior. */
export default function nativeHistoryBounds(segments, latest, base, timeScale) {
    if (!latest) { return []; }
    const until = Math.round(latest.context.page.until / timeScale);
    if (base.nativeTailMode !== undefined && (base.nativeTailMode !== nativeTailProtocol || base.replace)) {
        throw new TypeError('Unsupported native history suffix protocol');
    }
    const owners = new Map(segments.map(item => { return [item, provedOwner(item, latest, base, until)]; }).filter(([, owner]) => { return owner; }));
    if (!base.replace) { retainExterior(segments, latest.segments ?? [], owners, until); }
    return [...owners.keys()].filter(item => { return instant(item.start_time) > until; });
}
