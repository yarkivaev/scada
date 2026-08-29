function sameInstant(a, b) {
    return new Date(a).getTime() === new Date(b).getTime();
}

function trackOf(row) {
    return row.kind || 'phase';
}

function wantedKinds(range) {
    if (range && Array.isArray(range.kinds) && range.kinds.length > 0) {
        return range.kinds;
    }
    return ['phase'];
}

function findRow(store, machineId, start) {
    return store.segments.find((row) => {
        return row.machine === machineId && trackOf(row) === 'phase' && sameInstant(row.start_time, start);
    });
}

function parseListFilters(range) {
    const from = range.from ?? null;
    const to = range.to ?? null;
    return { from, to };
}

function filterList(store, machineId, range) {
    const { from, to } = parseListFilters(range);
    const kinds = wantedKinds(range);
    return store.segments.filter((row) => {
        if (row.machine !== machineId) {
            return false;
        }
        if (!kinds.includes(trackOf(row))) {
            return false;
        }
        if (from && new Date(row.end_time).getTime() < new Date(from).getTime() && row.duration !== 0) {
            return false;
        }
        if (to && new Date(row.start_time).getTime() > new Date(to).getTime()) {
            return false;
        }
        return true;
    }).sort((a, b) => {
        return new Date(a.start_time) - new Date(b.start_time);
    });
}

function latestRows(store, machineId, kinds) {
    const latest = new Map();
    store.segments.filter((row) => {
        return row.machine === machineId && kinds.includes(trackOf(row));
    }).forEach((row) => {
        const prev = latest.get(trackOf(row));
        if (!prev || new Date(row.start_time) > new Date(prev.start_time)) {
            latest.set(trackOf(row), row);
        }
    });
    return Array.from(latest.values());
}

function pendingRows(store, machineId) {
    return store.segments.filter((row) => {
        return row.machine === machineId && row.resolved === false && trackOf(row) === 'phase';
    }).sort((a, b) => {
        return new Date(a.start_time) - new Date(b.start_time);
    }).map((row) => {
        return {
            id: row.start_time,
            name: row.name,
            start_time: row.start_time,
            end_time: row.end_time,
            duration: row.duration,
            options: row.options
        };
    });
}

function reads(store) {
    return {
        listForMachine(machineId, range) {
            return filterList(store, machineId, range);
        },
        latestForKinds(machineId, kinds) {
            if (!Array.isArray(kinds) || kinds.length === 0) {
                return [];
            }
            return latestRows(store, machineId, kinds);
        },
        rowAt(machineId, start) {
            return findRow(store, machineId, start) ?? null;
        },
        pendingRequestsForMachine(machineId) {
            return pendingRows(store, machineId);
        }
    };
}

function writes(store) {
    return {
        retag(machineId, start, tagsJson, propertiesJson) {
            const row = findRow(store, machineId, start);
            if (!row) {
                return 0;
            }
            row.tags = tagsJson;
            row.properties = propertiesJson;
            return 1;
        },
        resolveRequest(machineId, startKey, tagsJson, propertiesJson) {
            const row = findRow(store, machineId, startKey);
            if (!row) {
                return 0;
            }
            row.tags = tagsJson;
            row.properties = propertiesJson;
            row.resolved = true;
            row.consumed = false;
            return 1;
        }
    };
}

/**
 * In-memory segment state port for tests and local runs.
 *
 * @param {object} store - shared mutable store with segments array
 * @returns {object} segments port matching segmentStatePg shape
 */
export default function segmentStateMemory(store) {
    return { ...reads(store), ...writes(store) };
}
