import risesSql from './risesSql.js';
import changesSql from './changesSql.js';
import queryTopic from './queryTopic.js';
import rangeSql from './rangeSql.js';

export default function metricsStatePg(pool) {
    return {
        async latestForTopic(topic) {
            const result = await pool.query(
                'SELECT ts, value FROM metrics WHERE topic = $1 ORDER BY ts DESC LIMIT 1',
                [topic]
            );
            return result.rows[0] ?? null;
        },
        rangeForTopic(topic, startIso, endIso, stepMs) {
            const seconds = Math.max(1, Math.floor(stepMs / 1000));
            return queryTopic(pool, rangeSql(), [`${seconds} seconds`, topic, startIso, endIso]);
        },
        risesForTopic(topic, startIso, endIso) {
            return queryTopic(pool, risesSql(), [topic, startIso, endIso]);
        },
        changesForTopic(topic, startIso, endIso) {
            return queryTopic(pool, changesSql(), [topic, startIso, endIso]);
        },
        async pollTopic(topic, afterIso, untilIso) {
            const result = await pool.query(
                'SELECT ts, value FROM metrics WHERE topic = $1 AND ts > $2 AND ts <= $3 ORDER BY ts LIMIT 100',
                [topic, afterIso, untilIso]
            );
            return result.rows.map((row) => {
                return { ts: row.ts, value: row.value };
            });
        },
        async insertRows(items) {
            const topics = items.map((row) => {
                return row.topic;
            });
            const tss = items.map((row) => {
                return row.ts;
            });
            const values = items.map((row) => {
                return row.value;
            });
            await pool.query(
                'INSERT INTO metrics (topic, ts, value) SELECT * FROM unnest($1::text[], $2::timestamptz[], $3::float8[])',
                [topics, tss, values]
            );
        }
    };
}

/**
 * Sink adapter for mqttMetrics writing into supervisor-sink metrics table.
 *
 * @param {object} pool - PostgreSQL pool
 * @returns {object} sink with write(records)
 */
export function metricsSinkFromPool(pool) {
    const metrics = metricsStatePg(pool);
    return {
        async write(records) {
            if (records.length === 0) {
                return;
            }
            const items = records.map((row) => {
                return {
                    topic: row.topic,
                    ts: row.ts instanceof Date ? row.ts : new Date(row.ts),
                    value: row.value
                };
            });
            await metrics.insertRows(items);
        }
    };
}
