/**
 * Builds a prefix sum of 0→1 edges on an ordered numeric series.
 *
 * Heartbeat repeats of 1 do not increment. A series that starts already
 * high does not produce a prefix until a later 0→1 pair.
 *
 * @example
 *   risingPrefixes([
 *       { ts: new Date('2026-09-30T00:00:00.000Z'), value: 0 },
 *       { ts: new Date('2026-09-30T00:00:01.000Z'), value: 1 }
 *   ]);
 *
 * @param {Array<{ts: Date|string, value: number}>} rows - ordered samples
 * @returns {Array<{ts: Date|string, value: number}>} prefix points
 */
export default function risingPrefixes(rows) {
    let previous;
    let count = 0;
    const prefixes = [];
    (rows || []).forEach((row) => {
        const value = Number(row.value);
        if (previous === 0 && value === 1) {
            count += 1;
            prefixes.push({ ts: row.ts, value: count });
        }
        previous = value;
    });
    return prefixes;
}
