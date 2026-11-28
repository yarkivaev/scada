function instant(value) {
    return new Date(value).getTime();
}

function copy(row) {
    return { ...row };
}

function tagsOf(row) {
    const raw = typeof row.tags === 'string' ? row.tags : JSON.stringify(row.tags ?? null);
    if (raw === '' || raw === 'null' || raw === '[]') {
        return '[]';
    }
    return raw;
}

function parsed(row) {
    const raw = row.properties;
    if (typeof raw !== 'string') {
        return raw ?? {};
    }
    return JSON.parse(raw || 'null') ?? {};
}

function splitKey(row) {
    const value = parsed(row).split_of;
    return value ? String(value) : '';
}

function emptyUnsplit(row) {
    return tagsOf(row) === '[]' && !splitKey(row);
}

function overlaps(left, right) {
    return instant(left.start_time) < instant(right.end_time) && instant(right.start_time) < instant(left.end_time);
}

function liveJoin(left, right) {
    return left.name === right.name && (left.duration === 0 || right.duration === 0)
        && instant(left.start_time) <= instant(right.start_time)
        && instant(left.end_time) >= instant(right.start_time);
}

function covers(outer, inner) {
    return instant(outer.start_time) <= instant(inner.start_time) && instant(outer.end_time) >= instant(inner.end_time);
}

function stamp(ms, sample) {
    if (sample.start_time instanceof Date) {
        return new Date(ms);
    }
    return new Date(ms).toISOString();
}

function stretch(host, item) {
    const start = Math.min(instant(host.start_time), instant(item.start_time));
    const end = Math.max(instant(host.end_time), instant(item.end_time));
    host.start_time = stamp(start, host);
    host.end_time = stamp(end, host);
    if (host.duration !== 0 || item.duration !== 0) {
        host.duration = (end - start) / 1000;
    }
}

function extendTail(host, item) {
    if (instant(item.end_time) <= instant(host.end_time)) {
        return;
    }
    host.end_time = stamp(instant(item.end_time), host);
    if (host.duration !== 0) {
        host.duration = (instant(host.end_time) - instant(host.start_time)) / 1000;
    }
}

function tail(rows, piece) {
    const key = splitKey(piece);
    return rows.filter((row) => {
        return row.name === piece.name && splitKey(row) === key;
    }).reduce((best, row) => {
        return instant(row.start_time) >= instant(best.start_time) ? row : best;
    });
}

function subtract(piece, block) {
    if (!overlaps(piece, block)) {
        return [piece];
    }
    const start = instant(piece.start_time);
    const end = instant(piece.end_time);
    const left = instant(block.start_time);
    const right = instant(block.end_time);
    const parts = [];
    if (start < left) {
        parts.push({ ...piece, start_time: stamp(start, piece), end_time: stamp(left, piece),
            duration: piece.duration === 0 ? 0 : (left - start) / 1000 });
    }
    if (end > right) {
        parts.push({ ...piece, start_time: stamp(right, piece), end_time: stamp(end, piece),
            duration: piece.duration === 0 ? 0 : (end - right) / 1000 });
    }
    return parts;
}

function clip(item, blockers) {
    return blockers.reduce((parts, block) => {
        return parts.flatMap((piece) => {
            return subtract(piece, block);
        });
    }, [item]);
}

function collapse(rows) {
    const ordered = [...rows].sort((left, right) => {
        return instant(left.start_time) - instant(right.start_time);
    });
    return ordered.reduce((kept, row) => {
        const host = kept.find((prev) => {
            return prev.name === row.name && tagsOf(prev) === tagsOf(row)
                && !splitKey(prev) && !splitKey(row) && (overlaps(prev, row) || liveJoin(prev, row));
        });
        if (host) {
            stretch(host, row);
            return kept;
        }
        kept.push(copy(row));
        return kept;
    }, []);
}

function dropEmptyCovers(rows, item) {
    if (emptyUnsplit(item)) {
        return rows;
    }
    return rows.flatMap((row) => {
        if (row.name !== item.name || !overlaps(row, item) || !emptyUnsplit(row)) {
            return [row];
        }
        return subtract(row, item);
    });
}

function clipForeign(rows, item) {
    if (emptyUnsplit(item)) {
        return rows.flatMap((row) => {
            if (row.name === item.name || !emptyUnsplit(row)) {
                return [row];
            }
            return subtract(row, item);
        });
    }
    return rows.flatMap((row) => {
        return row.name === item.name ? [row] : subtract(row, item);
    });
}

function hostOf(rows, item) {
    const same = rows.filter((row) => {
        return row.name === item.name && (overlaps(row, item) || liveJoin(row, item));
    });
    const covered = same.find((row) => {
        return covers(row, item) && tagsOf(row) === tagsOf(item);
    });
    if (covered) {
        return { kind: 'cover', host: covered };
    }
    const split = same.find((row) => {
        return splitKey(row);
    });
    if (split) {
        return { kind: 'split', host: tail(rows, split) };
    }
    const mergeable = same.filter((row) => {
        return !splitKey(row) && tagsOf(row) === tagsOf(item);
    });
    if (mergeable.length) {
        return { kind: 'merge', host: mergeable.reduce((best, row) => {
            return instant(row.start_time) < instant(best.start_time) ? row : best;
        }) };
    }
    return { kind: 'new' };
}

function carve(rows, host) {
    const blockers = rows.filter((row) => {
        return row !== host && (row.name !== host.name || tagsOf(row) !== tagsOf(host));
    });
    return rows.filter((row) => {
        return row !== host;
    }).concat(clip(copy(host), blockers));
}

function place(rows, item) {
    const pruned = dropEmptyCovers(rows, item);
    const found = hostOf(pruned, item);
    if (found.kind === 'cover') {
        return carve(pruned, found.host);
    }
    if (found.kind === 'split') {
        extendTail(found.host, item);
        return pruned;
    }
    if (found.kind === 'merge') {
        stretch(found.host, item);
        return carve(pruned, found.host);
    }
    const clipped = clipForeign(pruned, item);
    const blockers = clipped.filter((row) => {
        return row.name !== item.name || tagsOf(row) !== tagsOf(item);
    });
    return clipped.concat(clip(copy(item), blockers));
}

/**
 * Merges a later classification pass into stored phases without replacing
 * operator tags or split cuts.
 *
 * @param {Array<object>} stored - already persisted phase rows
 * @param {Array<object>} incoming - phases from the later stream
 * @returns {Array<object>} phases after the later stream
 *
 * @example
 *   historyFold(stored, incoming);
 */
export default function historyFold(stored, incoming) {
    return incoming.reduce((rows, item) => {
        return collapse(place(rows, item));
    }, collapse(stored.map(copy)));
}
