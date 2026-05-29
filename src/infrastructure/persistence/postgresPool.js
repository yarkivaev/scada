import pg from 'pg';

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
    return new pg.Pool({ connectionString: url });
}
