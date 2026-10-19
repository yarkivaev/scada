import pg from 'pg';

/**
 * Logs an idle postgres client failure and leaves the pool open.
 * node-postgres emits `error` when an idle socket dies. With no listener
 * the process exits.
 *
 * @param {import('pg').Pool} pool - long-lived pool
 * @returns {import('pg').Pool} the same pool
 *
 * @example
 *   holdClient(new pg.Pool({ connectionString: process.env.POSTGRES_URL }));
 */
export function holdClient(pool) {
    const host = pool.options && pool.options.host ? pool.options.host : 'postgres';
    pool.on('error', (err) => {
        process.stderr.write(`[scada] postgres idle client failed host=${host} message=${err.message}\n`);
    });
    return pool;
}

/**
 * Creates a PostgreSQL pool for supervisor state reads.
 *
 * @param {object} [options] - optional existing pool or connection string
 * @returns {object|undefined} pg pool
 *
 * @example
 *   const pool = postgresPool({ connectionString: process.env.SUPERVISOR_STATE_PG_URL });
 */
export default function postgresPool(options = {}) {
    if (options.pool) {
        return options.pool;
    }
    const url = options.connectionString
        || process.env.SUPERVISOR_STATE_PG_URL
        || process.env.SUPERVISOR_STATE_DATABASE_URL
        || process.env.POSTGRES_URL;
    if (!url) {
        return undefined;
    }
    return holdClient(new pg.Pool({ connectionString: url }));
}
