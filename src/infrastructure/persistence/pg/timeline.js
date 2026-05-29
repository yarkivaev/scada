import segmentStatePg from './segments.js';

function mapRow(item) {
    const tags = item.tags === undefined || item.tags === null ? null : item.tags;
    const properties = item.properties === undefined || item.properties === null ? null : item.properties;
    return {
        name: item.name,
        start_time: new Date(item.start_time),
        end_time: new Date(item.end_time),
        duration: item.duration,
        options: item.options,
        tags,
        properties
    };
}

/**
 * Postgres-backed timeline read port for one machine.
 *
 * @param {object} pool - pg pool
 * @param {string} machineId - machine identifier
 * @returns {object} timeline read port with list, rowAt, pending
 *
 * @example
 *   const pg = pgTimeline(pool, 'icht1');
 *   await pg.list({ from: '2024-01-01' });
 */
export default function pgTimeline(pool, machineId) {
    const segments = segmentStatePg(pool);
    return {
        async list(range) {
            const rows = await segments.listForMachine(machineId, range || {});
            return rows.map(mapRow);
        },
        async rowAt(start) {
            const row = await segments.rowAt(machineId, start);
            return row ? mapRow(row) : null;
        },
        async pending() {
            const rows = await segments.pendingRequestsForMachine(machineId);
            return rows.map((item) => {
                return {
                    id: item.id,
                    name: item.name,
                    start_time: new Date(item.start_time),
                    end_time: new Date(item.end_time),
                    duration: item.duration,
                    options: item.options
                };
            });
        }
    };
}
