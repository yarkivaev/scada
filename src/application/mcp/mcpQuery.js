import { z } from 'zod';
import sqlGuard from '../../domain/sql/sqlGuard.js';
import { capRows, toolText } from './mcpText.js';

/**
 * Guards SQL, runs the port, and caps rows.
 *
 * @param {string} sql - statement
 * @param {string} engine - clickhouse or postgres
 * @param {Function} query - port
 * @returns {Promise<object>} tool result
 *
 * @example
 *   runQuery('SELECT 1', 'postgres', () => []);
 */
async function runQuery(sql, engine, query) {
    const guarded = sqlGuard(sql, engine);
    const rows = await query(guarded);
    return toolText(capRows(rows));
}

/**
 * Registers read-only ClickHouse SQL.
 *
 * @param {object} server - McpServer
 * @param {object} ports - read ports
 * @returns {void}
 *
 * @example
 *   registerClickhouse(server, ports);
 */
function registerClickhouse(server, ports) {
    server.registerTool('query_clickhouse', {
        description: 'Read-only ClickHouse SQL with a ts predicate',
        inputSchema: {
            sql: z.string()
        }
    }, (args) => {
        return runQuery(args.sql, 'clickhouse', ports.queryClickhouse);
    });
}

/**
 * Registers read-only Postgres SQL when a standby port exists.
 *
 * @param {object} server - McpServer
 * @param {object} ports - read ports
 * @returns {void}
 *
 * @example
 *   registerPostgres(server, ports);
 */
function registerPostgres(server, ports) {
    if (typeof ports.queryPostgres !== 'function') {
        return;
    }
    server.registerTool('query_postgres', {
        description: 'Read-only Postgres SQL',
        inputSchema: {
            sql: z.string()
        }
    }, (args) => {
        return runQuery(args.sql, 'postgres', ports.queryPostgres);
    });
}

/**
 * Registers SQL tools. Postgres is omitted without a standby port.
 *
 * @param {object} server - McpServer
 * @param {object} ports - read ports
 * @returns {void}
 *
 * @example
 *   registerQueries(server, ports);
 */
export default function registerQueries(server, ports) {
    registerClickhouse(server, ports);
    registerPostgres(server, ports);
}
