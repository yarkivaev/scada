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
