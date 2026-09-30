/**
 * Orders one topic and splits a prior sample from the requested window.
 *
 * @param {Array<{topic: string, ts: Date|string, value: number}>} rows - store
 * @param {string} topic - metric topic
 * @returns {Array<{topic: string, ts: Date, value: number}>} time-ordered hits
 */
export function topicRows(rows, topic) {
    return (rows || []).filter((row) => {
        return row.topic === topic;
    }).map((row) => {
        return { topic: row.topic, ts: new Date(row.ts), value: row.value };
    }).sort((left, right) => {
        return left.ts.getTime() - right.ts.getTime();
    });
}

/**
 * Preceding sample plus in-window rows for lag-based queries.
 *
 * @param {Array<{ts: Date, value: number}>} rows - one topic ordered
 * @param {number} startMs - window start
 * @param {number} endMs - window end
 * @param {boolean} closed - true when the end is inclusive
 * @returns {Array<{ts: Date, value: number}>} prior plus window
 */
export function seriesWindow(rows, startMs, endMs, closed) {
    const prior = rows.filter((row) => {
        return row.ts.getTime() < startMs;
    }).pop();
    const window = rows.filter((row) => {
        const ts = row.ts.getTime();
        if (ts < startMs) {
            return false;
        }
        return closed ? ts <= endMs : ts < endMs;
    });
    return prior ? [prior].concat(window) : window;
}
