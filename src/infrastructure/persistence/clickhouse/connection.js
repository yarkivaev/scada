/**
 * ClickHouse connection factory for SCADA metrics storage.
 *
 * Provides connection with query and insert methods for sensor data.
 * When username is provided, skips schema initialization (for read-only users).
 *
 * @param {string} host - ClickHouse host
 * @param {object} options - connection options
 * @param {number} options.port - ClickHouse HTTP port (default: 8123)
 * @param {string} options.username - ClickHouse username (optional)
 * @param {string} options.password - ClickHouse password (optional)
 * @returns {object} connection with query, insert, and close methods
 *
 * @example
 *   const conn = await clickhouseConnection('localhost', { username: 'readonly', password: 'secret' });
 *   const rows = await conn.query('SELECT * FROM scada.metrics WHERE topic = {topic:String}', { topic: 'm1/voltage' });
 *   await conn.close();
 */
import { createClient } from '@clickhouse/client';

export default async function clickhouseConnection(host, options = {}) {
    const port = options.port || 8123;
    const {username} = options;
    const {password} = options;
    const config = { url: `http://${host}:${port}` };
    if (username) {
        config.username = username;
        config.password = password || '';
    }
    const client = createClient(config);
    if (!username) {
        await client.command({ query: 'CREATE DATABASE IF NOT EXISTS scada' });
        await client.command({
            query: `CREATE TABLE IF NOT EXISTS scada.metrics (
                topic String, ts DateTime64(3), value Float64
            ) ENGINE = MergeTree() ORDER BY (topic, ts)`
        });
    }
    return {
        url() {
            return `http://${host}:${port}`;
        },
        async query(sql, params = {}) {
            const result = await client.query({
                query: sql,
                query_params: params,
                format: 'JSONEachRow'
            });
            return result.json();
        },
        async insert(table, rows) {
            await client.insert({ table, values: rows, format: 'JSONEachRow' });
        },
        async close() {
            await client.close();
        }
    };
}
