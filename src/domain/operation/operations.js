function stampRow(item, updatedAt) {
    return {
        machine: item.machine,
        occurred_at: item.occurred_at,
        kind: item.kind,
        key: item.key,
        payload: item.payload,
        source_updated_at: updatedAt
    };
}

function loadKind(persistence, sources, machineId, kind, range) {
    const source = sources[kind];
    if (source) {
        return source.list(machineId, range);
    }
    return persistence.listForMachine(machineId, kind, range);
}

function resolveKinds(kinds, sources) {
    if (kinds === undefined) {
        return Object.keys(sources);
    }
    if (Array.isArray(kinds)) {
        return kinds;
    }
    return [kinds];
}

function announce(bus, result, row) {
    bus.emit({
        type: result.created ? 'created' : 'updated',
        operation: row
    });
}

function writeOne(persistence, bus, item) {
    const row = stampRow(item, new Date());
    return persistence.upsert(row).then((result) => {
        announce(bus, result, row);
    });
}

function writeMany(persistence, bus, items) {
    if (typeof persistence.upsertMany !== 'function') {
        throw new Error('Operations persistence must have an upsertMany() method');
    }
    const rows = items.map((item) => {
        return stampRow(item, new Date());
    });
    return persistence.upsertMany(rows).then((results) => {
        rows.forEach((row, index) => {
            announce(bus, results[index], row);
        });
    });
}

/**
 * Operations wired to persistence, pubsub, and optional non-PG kind sources.
 *
 * listForMachine merges requested kinds from injectable sources and Postgres,
 * sorted by occurred_at. Omitted kinds default to injectable source keys.
 * latestForMachine reads only from persistence (single kind).
 *
 * @param {object} persistence - store with upsert, get, remove, listForMachine, latestForMachine
 * @param {object} bus - pubsub instance with stream and emit methods
 * @param {object} [kindSources] - map of kind to { list(machineId, range) }
 * @returns {object} operations with listForMachine, latestForMachine, upsert, upsertMany, get, remove, stream
 *
 * @example
 *   const ops = operations(store, bus, { temp: temperaturePort });
 *   await ops.listForMachine('m1', ['sample', 'temp'], { from: new Date() });
 *   await ops.latestForMachine('m1', 'sample', { to: new Date() });
 *   await ops.remove('m1', 'nb-1');
 */
export default function operations(persistence, bus, kindSources) {
    const sources = kindSources || {};
    return {
        listForMachine(machineId, kinds, range) {
            const requested = resolveKinds(kinds, sources);
            if (requested.length === 0) {
                return Promise.resolve([]);
            }
            return Promise.all(requested.map((kind) => {
                return loadKind(persistence, sources, machineId, kind, range);
            })).then((batches) => {
                return batches.flat().sort((left, right) => {
                    return new Date(left.occurred_at) - new Date(right.occurred_at);
                });
            });
        },
        latestForMachine(machineId, kind, bound) {
            return persistence.latestForMachine(machineId, kind, bound);
        },
        upsert(item) {
            return writeOne(persistence, bus, item);
        },
        upsertMany(items) {
            return writeMany(persistence, bus, items);
        },
        get(machineId, key) {
            return persistence.get(machineId, key);
        },
        remove(machineId, key) {
            return persistence.remove(machineId, key).then((operation) => {
                bus.emit({ type: 'deleted', operation });
                return operation;
            });
        },
        stream: bus.stream
    };
}
