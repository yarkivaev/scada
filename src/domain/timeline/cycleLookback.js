function tagList(row) {
    const raw = row.tags;
    if (Array.isArray(raw)) {
        return raw;
    }
    if (typeof raw === 'string' && raw.length > 0) {
        return JSON.parse(raw);
    }
    return [];
}

/**
 * Walks newest-first timeline rows until a reset tag and returns them oldest-first.
 *
 * Reset ids are opaque; callers pass cycle start/stop tags.
 *
 * @param {Array<object>} rows - newest-first rows with tags
 * @param {Array<string>} resetTags - tag ids that close the lookback
 * @returns {Array<object>} chronological slice including the reset row
 *
 * @example
 *   cycleLookback(newestFirst, ['cycle-start', 'cycle-stop'])
 */
export default function cycleLookback(rows, resetTags) {
    const reset = new Set(resetTags);
    const collected = [];
    for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        collected.push(row);
        if (tagList(row).some((id) => {
            return reset.has(id);
        })) {
            break;
        }
    }
    return collected.reverse();
}
