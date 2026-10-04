import risingPrefixes from '../risingPrefixes.js';
import levelChanges from '../levelChanges.js';
import coverageHolds from '../coverageHolds.js';
import { seriesWindow, topicRows } from '../topicWindow.js';

function bucketKey(tsMs, originMs, stepMs) {
    const slot = Math.floor((tsMs - originMs) / stepMs);
    return originMs + slot * stepMs;
}

function rowsForRange(store, topic, startMs, endMs, stepMs) {
    const hits = store.metrics.filter((row) => {
        const tsMs = new Date(row.ts).getTime();
        return row.topic === topic && tsMs >= startMs && tsMs <= endMs;
    }).sort((a, b) => {
        return new Date(a.ts) - new Date(b.ts);
    });
    const byBucket = new Map();
    hits.forEach((row) => {
        const tsMs = new Date(row.ts).getTime();
        const key = bucketKey(tsMs, startMs, stepMs);
        byBucket.set(key, row);
    });
    return Array.from(byBucket.entries()).sort((a, b) => {
        return a[0] - b[0];
    }).map((entry) => {
        return { ts: new Date(entry[0]), value: entry[1].value };
    });
}

function risesOf(rows, topic, startIso, endIso) {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    const series = seriesWindow(topicRows(rows, topic), start, end, false);
    return risingPrefixes(series).filter((row) => {
        const ts = new Date(row.ts).getTime();
        return ts >= start && ts < end;
    });
}

function changesOf(rows, topic, startIso, endIso) {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    const series = seriesWindow(topicRows(rows, topic), start, end, true);
    return levelChanges(series).map((row, index) => {
        if (index === 0 && new Date(row.ts).getTime() < start) {
            return { ts: new Date(start), value: row.value };
        }
        return { ts: row.ts, value: row.value };
    });
}

function holdsOf(rows, topic, startIso, endIso, stepMs) {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    const hits = rows.filter((row) => {
        return row.topic === topic;
    });
    return coverageHolds(hits, start, end, Math.max(1, Number(stepMs) || 1000));
}

/**
 * In-memory metrics state port for tests and local runs.
 *
 * @param {object} store - shared mutable store with metrics array
 * @returns {object} metrics port matching metricsStatePg shape
 */
export default function metricsStateMemory(store) {
    return {
        latestForTopic(topic) {
            const hits = store.metrics.filter((row) => {
                return row.topic === topic;
            }).sort((a, b) => {
                return new Date(b.ts) - new Date(a.ts);
            });
            return hits[0] ?? null;
        },
        rangeForTopic(topic, startIso, endIso, stepMs) {
            const start = new Date(startIso).getTime();
            const end = new Date(endIso).getTime();
            const stepSec = Math.max(1, Math.floor(stepMs / 1000));
            return rowsForRange(store, topic, start, end, stepSec * 1000);
        },
        risesForTopic(topic, startIso, endIso) {
            return risesOf(store.metrics, topic, startIso, endIso);
        },
        changesForTopic(topic, startIso, endIso) {
            return changesOf(store.metrics, topic, startIso, endIso);
        },
        holdsForTopic(topic, startIso, endIso, stepMs) {
            return holdsOf(store.metrics, topic, startIso, endIso, stepMs);
        },
        pollTopic(topic, afterIso, untilIso) {
            const after = new Date(afterIso).getTime();
            const until = new Date(untilIso).getTime();
            return store.metrics.filter((row) => {
                const tsMs = new Date(row.ts).getTime();
                return row.topic === topic && tsMs > after && tsMs <= until;
            }).sort((a, b) => {
                return new Date(a.ts) - new Date(b.ts);
            }).slice(0, 100).map((row) => {
                return { ts: row.ts, value: row.value };
            });
        },
        insertRows(items) {
            let i = 0;
            while (i < items.length) {
                const row = items[i];
                store.metrics.push({ topic: row.topic, ts: new Date(row.ts), value: row.value });
                i += 1;
            }
        }
    };
}
