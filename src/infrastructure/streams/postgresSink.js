import pg from 'pg';
import deadline from './deadline.js';
import positive from './positive.js';

/**
 * Removes duplicate records by conflict key within a batch.
 *
 * PostgreSQL rejects INSERT batches where ON CONFLICT would update
 * the same row twice. This keeps the last occurrence for each
 * unique combination of conflict column values.
 *
 * @example
 *   deduplicate(
 *     [{ machine: 'a', start: 1, name: 'pending' },
 *      { machine: 'a', start: 1, name: 'completed' }],
 *     ['machine', 'start']
 *   );
 *   // => [{ machine: 'a', start: 1, name: 'completed' }]
 *
 * @param {Array} records - Array of record objects
 * @param {Array<string>} keys - Conflict column names
 * @returns {Array} Deduplicated records
 */
export function deduplicate(records, keys) {
  if (keys.length === 0) {return records;}
  const seen = new Map();
  for (const record of records) {
    const key = keys.map(k => {return record[k]}).join('\0');
    seen.set(key, record);
  }
  return Array.from(seen.values());
}

/**
 * Builds the ON CONFLICT SQL suffix from options.
 *
 * @param {object} options - Sink options with conflict, update, and optional updateWhere
 * @returns {string} SQL suffix or empty string
 */
function buildSuffix(options) {
  if (!Array.isArray(options.conflict) || options.conflict.length === 0) {return '';}
  const cols = options.conflict.join(', ');
  if (Array.isArray(options.update) && options.update.length > 0) {
    const sets = options.update.map((col) => {return `${col} = EXCLUDED.${col}`}).join(', ');
    const guard = typeof options.updateWhere === 'string' && options.updateWhere.length > 0
      ? ` WHERE ${options.updateWhere}`
      : '';
    return ` ON CONFLICT (${cols}) DO UPDATE SET ${sets}${guard}`;
  }
  return ` ON CONFLICT (${cols}) DO NOTHING`;
}

/**
 * PostgreSQL sink for batch record insertion.
 *
 * Creates a pg.Pool internally unless `options.pool` is supplied.
 * Supports optional conflict resolution via ON CONFLICT DO NOTHING or
 * ON CONFLICT DO UPDATE SET. `write` accepts an optional queryable
 * client so callers can run inserts inside an existing transaction.
 *
 * @example
 * const sink = postgresSink('postgresql://localhost:5432/db', 'metrics', ['ts', 'value']);
 * await sink.write([{ ts: Date.now(), value: 42 }]);
 *
 * @example
 * const sink = postgresSink(url, 'segments', cols, { pool, conflict: ['machine', 'start_time'] });
 * await sink.write([{ machine: 'a', name: 'on', start_time: '2024-01-01' }], client);
 *
 * @param {string} url - PostgreSQL URL (e.g., 'postgresql://localhost:5432/db')
 * @param {string} table - Target table name
 * @param {Array<string>} columns - Column names for insertion
 * @param {object} [options] - Optional configuration
 * @param {Array<string>} [options.conflict] - Columns for ON CONFLICT clause
 * @param {Array<string>} [options.update] - Columns for DO UPDATE SET clause
 * @param {string} [options.updateWhere] - Optional WHERE guard on DO UPDATE
 * @param {object} [options.pool] - Existing pg Pool to reuse
 * @returns {object} Sink with write(records, client?) method
 */
export default function postgresSink(url, table, columns, options = {}) {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('URL must be a non-empty string');
  }
  if (typeof table !== 'string' || table.length === 0) {
    throw new Error('Table must be a non-empty string');
  }
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('Columns must be a non-empty array');
  }
  positive(options.stopTimeoutMs ?? 5000, 'stopTimeoutMs');
  const pool = options.pool || (options.createPool || ((config) => { return new pg.Pool(config); }))({ connectionString: url });
  let stopping;
  const suffix = buildSuffix(options);
  const conflict = Array.isArray(options.conflict) ? options.conflict : [];
  return {
    /**
     * Writes records to PostgreSQL table.
     *
     * @param {Array} records - Array of objects with keys matching columns
     * @param {object} [client] - Optional pg client/pool with query()
     * @returns {Promise} Promise resolving when insert completes
     */
    write(records, client) {
      if (stopping) { return Promise.reject(new Error('PostgreSQL sink stopped')); }
      if (client?.signal?.aborted) { return Promise.reject(client.signal.reason || new Error('PostgreSQL write aborted')); }
      const unique = deduplicate(records, conflict);
      const placeholders = unique.map((record, i) => {
        const offset = i * columns.length;
        const row = columns.map((__, j) => {return `$${offset + j + 1}`}).join(', ');
        return `(${row})`;
      }).join(', ');
      const query = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}${suffix}`;
      const values = unique.flatMap((record) => {return columns.map((col) => {return record[col]})});
      const runner = client && typeof client.query === 'function' ? client : pool;
      return runner.query(query, values);
    },
    stop() {
      stopping ??= deadline(Promise.resolve().then(() => {
        if (!options.pool) { return pool.end(); }
        return undefined;
      }), options.stopTimeoutMs ?? 5000, 'PostgreSQL pool close');
      return stopping;
    }
  };
}
