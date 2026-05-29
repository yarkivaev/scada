function sameInstant(a, b) {
    return new Date(a).getTime() === new Date(b).getTime();
}

function replayCursorFor(store, machineId) {
    const closed = store.segments.filter((row) => {
        return row.machine === machineId && new Date(row.end_time) > new Date(row.start_time);
    }).map((row) => {
        return new Date(row.end_time).getTime() / 1000;
    });
    const pending = store.segments.filter((row) => {
        return row.machine === machineId && sameInstant(row.start_time, row.end_time);
    }).map((row) => {
        return new Date(row.start_time).getTime() / 1000;
    });
    const closedMax = closed.length ? Math.max(...closed) : null;
    const pendingMax = pending.length ? Math.max(...pending) : null;
    let cursor = 0;
    if (closedMax !== null && pendingMax !== null) {
        cursor = Math.min(closedMax, pendingMax);
    } else if (pendingMax !== null) {
        cursor = pendingMax;
    } else if (closedMax !== null) {
        cursor = closedMax;
    }
    return cursor;
}

/**
 * In-memory checkpoint state port for tests and local runs.
 *
 * @param {object} store - shared mutable store with segments and metrics arrays
 * @returns {object} checkpoints port matching checkpointStatePg shape
 */
export default function checkpointStateMemory(store) {
    return {
        replayCursor(machineId) {
            return replayCursorFor(store, machineId);
        },
        pendingSegments() {
            return store.segments.filter((row) => {
                return sameInstant(row.start_time, row.end_time);
            }).map((row) => {
                return {
                    machine: row.machine,
                    name: row.name,
                    start: new Date(row.start_time).getTime() / 1000
                };
            });
        },
        readings(topics, fromEpoch) {
            const fromMs = Number(fromEpoch) * 1000;
            return store.metrics.filter((row) => {
                const tsMs = new Date(row.ts).getTime();
                return topics.includes(row.topic) && tsMs > fromMs;
            }).sort((a, b) => {
                return new Date(a.ts) - new Date(b.ts);
            }).map((row) => {
                return {
                    topic: row.topic,
                    timestamp: new Date(row.ts).getTime() / 1000,
                    value: Number(row.value)
                };
            });
        }
    };
}
