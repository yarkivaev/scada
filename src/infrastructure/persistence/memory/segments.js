function sameInstant(a, b) {
    return new Date(a).getTime() === new Date(b).getTime();
}

function findRow(store, machineId, start) {
    return store.segments.find((row) => {
        return row.machine === machineId && sameInstant(row.start_time, start);
    });
}

function parseListFilters(range) {
    const from = range.from ?? null;
    const to = range.to ?? null;
    return { from, to };
}

function filterList(store, machineId, range) {
    const { from, to } = parseListFilters(range);
    return store.segments.filter((row) => {
        if (row.machine !== machineId) {
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

/**
 * In-memory segment state port for tests and local runs.
 *
 * @param {object} store - shared mutable store with segments array
 * @returns {object} segments port matching segmentStatePg shape
 */
export default function segmentStateMemory(store) {
    return {
        listForMachine(machineId, range) {
            return filterList(store, machineId, range);
        },
        rowAt(machineId, start) {
            const row = findRow(store, machineId, start);
            return row ?? null;
        },
        pendingRequestsForMachine(machineId) {
            return store.segments.filter((row) => {
                return row.machine === machineId && row.resolved === false;
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
        },
        retag(machineId, start, tagsJson, propertiesJson) {
            const row = findRow(store, machineId, start);
            if (row) {
                row.tags = tagsJson;
                row.properties = propertiesJson;
            }
        },
        resolveRequest(machineId, startKey, tagsJson, propertiesJson) {
            const row = findRow(store, machineId, startKey);
            if (row) {
                row.tags = tagsJson;
                row.properties = propertiesJson;
                row.resolved = true;
                row.consumed = false;
            }
        }
    };
}
