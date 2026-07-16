function parseJsonField(raw) {
    if (!raw) {
        return null;
    }
    return JSON.parse(raw);
}

function segmentItem(row) {
    if (!row) {
        return null;
    }
    return {
        machine: row.machine,
        name: row.name,
        start: new Date(row.start_time).getTime() / 1000,
        end: new Date(row.end_time).getTime() / 1000,
        duration: row.duration,
        tags: parseJsonField(row.tags),
        options: parseJsonField(row.options),
        properties: parseJsonField(row.properties)
    };
}

function segmentAt(store, machineId, startEpoch) {
    const startMs = startEpoch * 1000;
    const row = store.segments.find((item) => {
        return item.machine === machineId && new Date(item.start_time).getTime() === startMs;
    });
    return segmentItem(row);
}

function replayCursorFor(store, machineId) {
    const closed = store.segments.filter((row) => {
        return row.machine === machineId && Number(row.duration) > 0;
    }).map((row) => {
        return new Date(row.end_time).getTime() / 1000;
    });
    const pending = store.segments.filter((row) => {
        return row.machine === machineId && Number(row.duration) === 0;
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
                return Number(row.duration) === 0;
            }).map((row) => {
                return {
                    machine: row.machine,
                    name: row.name,
                    start: new Date(row.start_time).getTime() / 1000,
                    end: new Date(row.end_time).getTime() / 1000
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
        },
        segment(machineId, startEpoch) {
            return segmentAt(store, machineId, startEpoch);
        }
    };
}
