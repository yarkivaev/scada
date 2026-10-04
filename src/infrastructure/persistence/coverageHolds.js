/**
 * Folds heartbeat samples into coverage holds.
 *
 * A new span starts on the first in-window sample, a value change,
 * or a silence longer than gap. Samples before the window are ignored.
 *
 * @param {Array<{ts: Date, value: *}>} rows - raw metric rows
 * @param {number} start - window start epoch milliseconds
 * @param {number} end - exclusive window end epoch milliseconds
 * @param {number} gap - maximum silence in milliseconds
 * @returns {Array<{ts: Date, value: *, until: Date}>} holds
 *
 * @example
 *   coverageHolds(rows, from, to, 3000);
 */
export default function coverageHolds(rows, start, end, gap) {
    const series = (rows || []).filter((row) => {
        const ts = new Date(row.ts).getTime();
        return ts >= start && ts < end;
    }).sort((left, right) => {
        return new Date(left.ts) - new Date(right.ts);
    });
    const spans = [];
    series.forEach((row) => {
        const ts = new Date(row.ts);
        const last = spans[spans.length - 1];
        if (!last) {
            spans.push({ ts, value: row.value, until: ts });
            return;
        }
        const silence = ts.getTime() - last.until.getTime();
        if (row.value !== last.value || silence > gap) {
            spans.push({ ts, value: row.value, until: ts });
            return;
        }
        last.until = ts;
    });
    return spans;
}
