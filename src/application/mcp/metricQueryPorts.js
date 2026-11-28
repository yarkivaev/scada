import coverageCursor from './coverageCursor.js';
import locate from './locateMachineMetric.js';

/**
 * Wraps a ClickHouse connection as the query_clickhouse port.
 *
 * @param {object} connection - clickhouseConnection
 * @returns {Function} SQL port
 *
 * @example
 *   clickhousePort(connection)('SELECT 1');
 */
export function clickhousePort(connection) {
    return function queryClickhouse(sql) {
        return connection.query(sql);
    };
}

/**
 * Wraps a Postgres pool as the query_postgres port.
 *
 * @param {object} pool - pg pool
 * @returns {Function} SQL port
 *
 * @example
 *   postgresPort(pool)('SELECT 1');
 */
export function postgresPort(pool) {
    return function queryPostgres(sql) {
        return pool.query(sql).then((result) => {
            return result.rows;
        });
    };
}

/**
 * Latest sensor instants for the machine or metric on a path.
 *
 * @param {object} site - plant hierarchy
 * @param {object} args - path
 * @returns {Promise<Array>} samples with ts
 *
 * @example
 *   latestSamples(site, { path: 'site/unit/power' });
 */
async function latestSamples(site, args) {
    const found = locate(site, args.path);
    if (found.metric && found.machine.sensors[found.metric]) {
        const row = await found.machine.sensors[found.metric].current();
        return row.found ? [{ ts: row.timestamp }] : [];
    }
    const keys = Object.keys(found.machine.sensors || {});
    const rows = await Promise.all(keys.map(async (key) => {
        const row = await found.machine.sensors[key].current();
        return row.found ? { ts: row.timestamp } : null;
    }));
    return rows.filter(Boolean);
}

/**
 * Coverage cursor: ingest checkpoint, else latest ClickHouse sample.
 *
 * @param {object|undefined} pool - pg pool
 * @param {object} site - plant hierarchy
 * @returns {Function} cursor port
 *
 * @example
 *   cursorPort(pool, site)({ path: 'site/unit' });
 */
export function cursorPort(pool, site) {
    const bound = coverageCursor(pool, (args) => {
        return latestSamples(site, args);
    });
    return function cursor(args) {
        const found = locate(site, args.path);
        return bound({ machine: found.machine.name(), path: args.path });
    };
}
