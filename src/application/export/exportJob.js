/**
 * Pulls one topic from Query for the given scope.
 *
 * @param {object} query - exportQuery port
 * @param {object} scope - { kind, machine, from, to, step, keys, ... }
 * @returns {Promise<*>} topic payload
 */
function pull(query, scope) {
    const { kind } = scope;
    if (kind === 'machines') {
        return query.machines();
    }
    if (kind === 'measurements') {
        return query.measurements(scope.machine, scope);
    }
    if (kind === 'segments') {
        return query.segments(scope.machine, scope);
    }
    if (kind === 'alerts') {
        return query.alerts(scope.machine, scope);
    }
    if (kind === 'operations') {
        return query.operations(scope.machine, scope);
    }
    throw new Error(`export job cannot pull unknown kind ${kind}`);
}

/**
 * Opens one Stream subscription for the given scope.
 *
 * @param {object} stream - exportStream port
 * @param {object} scope - { kind, machine, ... }
 * @returns {object} connection with on/close
 */
function open(stream, scope) {
    const { kind } = scope;
    if (kind === 'measurements') {
        return stream.measurements(scope.machine, scope);
    }
    if (kind === 'segments') {
        return stream.segments(scope.machine);
    }
    if (kind === 'alerts') {
        return stream.alerts(scope.machine);
    }
    if (kind === 'operations') {
        return stream.operations(scope.machine);
    }
    throw new Error(`export job cannot pipe unknown kind ${kind}`);
}

/**
 * Default SSE event names for a stream kind.
 *
 * @param {string} kind - stream topic
 * @returns {string[]} event names
 */
function defaultEvents(kind) {
    if (kind === 'measurements') {
        return ['measurement'];
    }
    if (kind === 'segments') {
        return ['segment_created', 'segment_resolved'];
    }
    if (kind === 'alerts') {
        return ['alert'];
    }
    if (kind === 'operations') {
        return ['operation_created', 'operation_updated'];
    }
    return [];
}

/**
 * Export Job: pulls Query or Stream, transforms, then writes to Sink.
 *
 * Query path uses run(scope). Stream path uses pipe(scope) and returns stop().
 * Transform and destination wiring belong to the caller (plant packages).
 *
 * @param {object} ports - { query?, stream?, transform?, sink }
 * @returns {object} frozen job with run and pipe
 *
 * @example
 *   const job = exportJob({ query, transform: (rows) => rows, sink });
 *   await job.run({ kind: 'segments', machine: 'furnace-α', from, to });
 *
 *   const live = exportJob({ stream, transform: (rows) => rows, sink });
 *   const handle = live.pipe({ kind: 'segments', machine: 'furnace-α', events: ['segment_created'] });
 *   handle.stop();
 */
export default function exportJob(ports) {
    const transform = ports.transform || function identity(rows) {
        return rows;
    };
    return Object.freeze({
        async run(scope) {
            const rows = await pull(ports.query, scope);
            const batch = await Promise.resolve(transform(rows));
            return ports.sink.write(batch);
        },
        pipe(scope) {
            const conn = open(ports.stream, scope);
            const events = scope.events || defaultEvents(scope.kind);
            events.forEach((name) => {
                conn.on(name, (payload) => {
                    Promise.resolve(transform([payload])).then((batch) => {
                        return ports.sink.write(batch);
                    });
                });
            });
            return Object.freeze({
                stop() {
                    conn.close();
                }
            });
        }
    });
}
