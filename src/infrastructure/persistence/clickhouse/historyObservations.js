import { createHash } from 'node:crypto';
import { assertSource, retentionFloor, usableCutoff } from './historySourceIdentity.js';

async function query(client, sql, params) {
    const result = await client.query({ query: sql, query_params: params, format: 'JSONEachRow' });
    return result.json();
}

function integer(value) {
    const result = Number(value);
    if (!Number.isSafeInteger(result)) { throw new Error('Historical timestamp exceeds exact supported coordinates'); }
    return result;
}

function groups(rows, left, end) {
    let size = 0;
    const selected = [];
    for (const row of rows) {
        if (selected.length === 250 || size + Number(row.size) > 10000) { break; }
        selected.push(row);
        size += Number(row.size);
    }
    if (rows.length && !selected.length) { throw new Error('One history timestamp group exceeds bounded context capacity'); }
    const next = rows[selected.length] ? integer(rows[selected.length].time) : null;
    return { from: left, until: next === null ? end : integer(selected.at(-1).time), next, end };
}

const canonical = `SELECT topic,toUnixTimestamp64Micro(ts) AS time,max(value) AS value FROM scada.metrics
    WHERE topic IN {topics:Array(String)} AND ts >= fromUnixTimestamp64Micro({left:Int64})
        AND ts <= fromUnixTimestamp64Micro({right:Int64}) GROUP BY topic,ts`;

function coverage(items, gap) {
    const continuity = [];
    for (const time of new Set(items.map((item) => { return item.time; }))) {
        const last = continuity.at(-1);
        if (last && time - last.until <= gap) {
            last.until = time;
        } else {
            continuity.push({ from: time, until: time });
        }
    }
    return continuity;
}

function sampleContext(rows, mapped, gap) {
    const byTopic = new Map(mapped.map(({ topic, channel }) => { return [topic, channel]; }));
    const canonicalChannels = new Map();
    for (const row of rows) {
        const channel = byTopic.get(row.topic);
        const time = integer(row.time);
        const value = Number(row.value);
        if (!Number.isFinite(value)) { throw new Error('Finite historical value required'); }
        const key = JSON.stringify([channel, time]);
        const old = canonicalChannels.get(key);
        if (!old || value > old.value) {
            const eventId = createHash('sha256').update(JSON.stringify([channel, time, value])).digest('hex');
            canonicalChannels.set(key, { eventId, channel, time, value });
        }
    }
    const items = [...canonicalChannels.values()].sort((left, right) => { return left.time - right.time || left.channel.localeCompare(right.channel); });
    return { items, continuity: coverage(items, gap) };
}

async function predecessor(client, { mapped, params, gap }) {
    const boundary = await query(client, `WITH times AS (SELECT DISTINCT time FROM (${canonical})), ordered AS (
        SELECT time,lagInFrame(toNullable(time),1) OVER(ORDER BY time ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS prior FROM times
    ) SELECT time FROM ordered WHERE isNull(prior) OR time-prior>{gap:Int64} ORDER BY time DESC LIMIT 1`, { ...params, gap });
    if (!boundary.length) { return null; }
    const since = integer(boundary[0].time);
    const rows = await query(client, `SELECT c.topic,argMax(c.value,c.time) AS value,max(c.time) AS time FROM (${canonical}) AS c GROUP BY c.topic`,
        { ...params, left: since });
    const channels = new Map(mapped.map(({ topic, channel }) => { return [topic, channel]; }));
    return {
        since, time: Math.max(...rows.map((row) => { return integer(row.time); })),
        values: Object.fromEntries(rows.map((row) => { return [channels.get(row.topic), Number(row.value)]; }))
    };
}

async function mappings(pool, machine) {
    await assertSource(pool, machine);
    const result = await pool.query('SELECT topic,channel,bucket_ms,retention_days FROM history_topics WHERE machine=$1 ORDER BY topic', [machine]);
    return result.rows;
}

async function extremes(client, pool, machine, direction, cutoff = null) {
    const mapped = await mappings(pool, machine);
    const filter = cutoff === null ? '' : ' AND ts >= fromUnixTimestamp64Micro({cutoff:Int64})';
    const samples = await Promise.all(mapped.map(async ({ topic }) => {
        const rows = await query(client, `SELECT toUnixTimestamp64Micro(ts) AS time FROM scada.metrics WHERE topic={topic:String}
            ${filter} ORDER BY ts ${direction} LIMIT 1`, { topic, ...(cutoff !== null && { cutoff }) });
        return rows.length ? integer(rows[0].time) : null;
    }));
    return samples.filter((value) => { return value !== null; });
}

async function parameters(pool, machine, left, right) {
    const mapped = await mappings(pool, machine);
    const floor = usableCutoff(await retentionFloor(pool));
    const topics = mapped.map(({ topic }) => { return topic; });
    return { mapped, params: { topics, left: floor === null ? left : Math.max(left, floor), right } };
}

async function registerSource(client, pool, machine, added, { now, reset }) {
    await assertSource(pool, machine, true);
    if (!reset && !added.length) { return; }
    const mapped = await mappings(pool, machine);
    const days = Math.max(...mapped.map(({ retention_days: retainedDays }) => { return Number(retainedDays); }));
    const floor = usableCutoff(await retentionFloor(pool));
    const window = (now() - days * 86400000) * 1000;
    const starts = await extremes(client, pool, machine, 'ASC', floor === null ? window : Math.max(window, floor));
    if (!starts.length) { return; }
    const from = Math.min(...starts);
    const until = Math.max(...await extremes(client, pool, machine, 'DESC'));
    await pool.query(`INSERT INTO history_work(id,machine,from_ms,until_ms) VALUES(md5($1||':external-bootstrap')::uuid,$1,$2,$3)
        ON CONFLICT(id) DO UPDATE SET from_ms=least(history_work.from_ms,excluded.from_ms),until_ms=greatest(history_work.until_ms,excluded.until_ms)`,
        [machine, from, until]);
}

/** Raw measurements stay in ClickHouse; only topic mappings and correction state are in PostgreSQL. */
export default function historyObservations(client, pool, { now = Date.now } = {}) {
    return {
        async start(machine) {
            const times = await extremes(client, pool, machine, 'ASC', usableCutoff(await retentionFloor(pool)));
            if (!times.length) { throw new Error('Raw ClickHouse history is unavailable; correction remains pending'); }
            return Math.min(...times);
        },
        async boundary(machine, from, until) {
            return Math.max(until, ...await extremes(client, pool, machine, 'DESC'));
        },
        async page(machine, left, end) {
            const { params } = await parameters(pool, machine, left, end);
            const rows = await query(client, `SELECT time,count() AS size FROM (${canonical}) GROUP BY time ORDER BY time LIMIT 251`, params);
            return groups(rows, left, end);
        },
        async read(machine, left, right, gap) {
            const { mapped, params } = await parameters(pool, machine, left, right);
            const rows = await query(client, `SELECT topic,time,value FROM (${canonical}) ORDER BY time,topic LIMIT 10001`, params);
            if (rows.length > 10000) { throw new Error('History context exceeds bounded observation capacity'); }
            return sampleContext(rows, mapped, gap);
        },
        async seed(machine, before, gap) {
            const { mapped, params } = await parameters(pool, machine, Date.UTC(1900, 0, 1) * 1000, before - 1);
            return predecessor(client, { mapped, params, gap });
        },
        registered(machine, added, { reset = false } = {}) {
            return registerSource(client, pool, machine, added, { now, reset });
        }
    };
}
