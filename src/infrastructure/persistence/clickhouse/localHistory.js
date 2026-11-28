import historyPg, { historyProtocol } from '../pg/history.js';
import historyObservations from './historyObservations.js';
import historyRetention from './historyRetention.js';
import { assertSources } from './historySourceIdentity.js';
import { micros } from './rowBinary.js';

export const clickhouseHistoryComment = `scada.local-history:${historyProtocol}`;

async function checkStorage(client, connection) {
    const result = await client.query({
        query: "SELECT create_table_query,comment FROM system.tables WHERE database='scada' AND name='metrics'",
        format: 'JSONEachRow'
    });
    const rows = await result.json();
    if (rows.length !== 1 || rows[0].comment !== clickhouseHistoryComment || /\bTTL\b/u.test(rows[0].create_table_query)) {
        throw new Error('Local history requires coordinated retention without autonomous ClickHouse TTL');
    }
    await connection.query('SELECT 1 FROM history_admissions LIMIT 0');
    await connection.query('SELECT 1 FROM history_checkpoints LIMIT 0');
    await connection.query('SELECT 1 FROM history_corrections LIMIT 0');
    await connection.query('SELECT 1 FROM history_staged_checkpoints LIMIT 0');
    await connection.query('SELECT 1 FROM history_retention LIMIT 0');
    await assertSources(connection);
}

async function historyWatermark(pool, observations) {
    const result = await pool.query('SELECT DISTINCT machine FROM history_topics');
    const machines = result.rows.map(({ machine }) => { return machine; });
    if (!machines.length) { return { observationMs: 0, segmentEndMs: 0 }; }
    const source = observations(pool);
    const times = await Promise.all(machines.map(async (machine) => { return Math.floor((await source.boundary(machine, 0, 0)) / 1000); }));
    const segments = await pool.query(`SELECT COALESCE((EXTRACT(EPOCH FROM max(end_time))*1000)::bigint,0) AS ms
        FROM segments WHERE kind='phase' AND machine=ANY($1)`, [machines]);
    return { observationMs: Math.min(...times), segmentEndMs: Number(segments.rows[0].ms) };
}

/** ClickHouse raw observations with transactional PostgreSQL correction and retention. */
export default function clickhouseLocalHistory(client, pool, { retentionDays = 30, now = Date.now, processorProperties = [], workPolicy } = {}) {
    function observations(connection) { return historyObservations(client, connection, { now }); }
    function ready(connection = pool) { return checkStorage(client, connection); }
    const history = historyPg(pool, {
        retentionDays, now, timeScale: 1000, processorProperties, observations, workPolicy,
        timestamp(value) { return Number(micros(value)); }
    });
    return {
        ...history, ready,
        watermark() { return historyWatermark(pool, observations); },
        purge() { return historyRetention(client, pool, { retentionDays, now, ready }); },
        async configure(...args) { await ready(); return history.configure(...args); }
    };
}
