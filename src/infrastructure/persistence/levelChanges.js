/**
 * Drops repeated samples from an ordered metric series.
 *
 * The first row is kept so a window can start from the level already held.
 * Later rows are kept only when the numeric value changes.
 *
 * @example
 *   levelChanges([
 *       { ts: new Date('2026-09-30T00:00:00.000Z'), value: 0 },
 *       { ts: new Date('2026-09-30T00:00:01.000Z'), value: 0 },
 *       { ts: new Date('2026-09-30T00:00:02.000Z'), value: 1 }
 *   ]);
 *
 * @param {Array<{ts: Date|string, value: number}>} rows - ordered samples
 * @returns {Array<{ts: Date|string, value: number}>} level changes
 */
export default function levelChanges(rows) {
    const kept = [];
    let previous;
    (rows || []).forEach((row) => {
        const value = Number(row.value);
        if (kept.length === 0 || value !== previous) {
            kept.push(row);
            previous = value;
        }
    });
    return kept;
}
