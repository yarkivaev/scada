import sqlShape from '../../domain/sql/sqlShape.js';

/**
 * Caps a journal string.
 *
 * @param {string} text - raw text
 * @returns {string} at most 512 characters
 *
 * @example
 *   cap('SELECT 1');
 */
function cap(text) {
    if (text.length > 512) {
        return text.slice(0, 512);
    }
    return text;
}

/**
 * Reads SQL from a query tool call.
 *
 * @param {string} name - tool or resource name
 * @param {object} [args] - tool arguments
 * @returns {string} SQL or an empty string
 *
 * @example
 *   sqlText('query_clickhouse', { sql: 'SELECT 1' });
 */
function sqlText(name, args) {
    if (name !== 'query_clickhouse' && name !== 'query_postgres') {
        return '';
    }
    if (args && typeof args.sql === 'string') {
        return args.sql;
    }
    return '';
}

/**
 * Builds the common journal fields.
 *
 * @param {object} ctx - caller and writers
 * @param {string} name - tool or resource name
 * @param {string} status - ok or error
 * @param {number} durationMs - elapsed milliseconds
 * @returns {object} journal record
 *
 * @example
 *   base({ caller: 'analyst' }, 'state', 'ok', 4);
 */
function base(ctx, name, status, durationMs) {
    return {
        caller: ctx.caller,
        durationMs,
        name,
        status,
        ts: new Date().toISOString()
    };
}

/**
 * Adds capped SQL text and a collapsed shape for query tools.
 *
 * @param {object} record - journal record
 * @param {string} name - tool or resource name
 * @param {object} [args] - tool arguments
 * @returns {object} record
 *
 * @example
 *   withSql({ name: 'state' }, 'state');
 */
function withSql(record, name, args) {
    const sql = sqlText(name, args);
    if (sql.length === 0) {
        return record;
    }
    return {
        ...record,
        shape: cap(sqlShape(sql)),
        sql: cap(sql)
    };
}

/**
 * Writes one JSON line and counts the call.
 *
 * @param {object} ctx - caller, journal, metrics
 * @param {string} name - tool or resource name
 * @param {string} status - ok or error
 * @param {number} started - epoch milliseconds
 * @param {object} [args] - tool arguments
 * @returns {void}
 *
 * @example
 *   note({ caller: 'analyst', journal() {}, metrics: { mark() {} } }, 'state', 'ok', Date.now());
 */
export default function note(ctx, name, status, started, args) {
    const durationMs = Date.now() - started;
    const record = base(ctx, name, status, durationMs);
    ctx.metrics.mark(name, status);
    ctx.journal(`${JSON.stringify(withSql(record, name, args))}\n`);
}
