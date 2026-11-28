import pg from 'pg';
import amqp from 'amqplib';
import {createClient} from '@clickhouse/client';
import replay from './telemetryReplay.js';

function required(env, name) {
    const value = env[name];
    if (!value) { throw new Error(`${name} is required`); }
    return value;
}
function bound(env, name, fallback) {
    return env[name] || fallback;
}
async function* pages(pool, from, to, size) {
    const client = await pool.connect();
    let committed = false;
    try {
        await client.query('BEGIN READ ONLY');
        await client.query(
            "DECLARE telemetry_replay NO SCROLL CURSOR FOR SELECT topic,to_char(ts AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS ts,value FROM metrics WHERE ts >= $1::timestamptz AND ts < $2::timestamptz ORDER BY topic,ts,float8send(value)",
            [from, to]
        );
        let batch;
        do {
            // eslint-disable-next-line no-await-in-loop
            batch = await client.query(`FETCH FORWARD ${size} FROM telemetry_replay`);
            if (batch.rows.length > 0) {
                yield batch.rows;
            }
        } while (batch.rows.length !== 0);
        await client.query('COMMIT');
        committed = true;
    } finally {
        const error = committed ? undefined : await client.query('ROLLBACK').then(() => {return undefined}, (failure) => {return failure});
        client.release(error);
    }
}
async function pull(client, from, to, size, offset) {
    const result = await client.query({
        query: `SELECT stored.topic,formatDateTime(stored.ts,'%F %T.%f','UTC') AS ts,stored.value
            FROM scada.metrics AS stored
            WHERE stored.ts >= parseDateTime64BestEffort({from:String},6,'UTC')
              AND stored.ts < parseDateTime64BestEffort({to:String},6,'UTC')
            ORDER BY stored.topic,stored.ts,stored.value LIMIT {size:UInt32} OFFSET {offset:UInt32}`,
        'query_params': {from, to, size, offset},
        format: 'JSONEachRow'
    });
    return result.json();
}
async function* clickhousePages(env, from, to, size) {
    const client = createClient({
        url: env.CLICKHOUSE_URL,
        username: bound(env, 'CLICKHOUSE_USER', 'default'),
        password: env.CLICKHOUSE_PASSWORD || '',
        'request_timeout': 120000
    });
    try {
        let offset = 0;
        let rows;
        do {
            // eslint-disable-next-line no-await-in-loop
            rows = await pull(client, from, to, size, offset);
            if (rows.length > 0) {
                yield rows;
            }
            offset += rows.length;
        } while (rows.length !== 0);
    } finally {
        await client.close();
    }
}
async function publish(channel, row) {
    const message = replay(row);
    await new Promise((resolve, reject) => {
        channel.publish(message.exchange, message.routingKey, Buffer.from(message.payload), {
            persistent: true,
            contentType: 'application/json'
        }, (error) => { if (error) { reject(error); } else { resolve(); } });
    });
}
async function* load(env, from, to, size) {
    if (env.CLICKHOUSE_URL) {
        yield* clickhousePages(env, from, to, size);
        return;
    }
    const pool = new pg.Pool({connectionString: required(env, 'POSTGRES_URL'), max: 1});
    try {
        yield* pages(pool, from, to, size);
    } finally {
        await pool.end();
    }
}
function replayWindow(env) {
    const now = Date.now();
    const from = env.SOURCE_FROM || new Date(now - Number(bound(env, 'LOOKBACK_MS', '28800000'))).toISOString();
    const to = env.SOURCE_TO || new Date(now).toISOString();
    const size = Number(bound(env, 'SOURCE_PAGE_SIZE', '2000'));
    if (!Number.isSafeInteger(size) || size < 1 || size > 100000) {
        throw new RangeError('Invalid telemetry replay page size');
    }
    return { from, to, size };
}

/** Republishes stored metrics onto the local telemetry exchange in bounded batches. */
export default async function replayStoredTelemetry(env) {
    const { from, to, size } = replayWindow(env);
    const connection = await amqp.connect(required(env, 'AMQP_URL'));
    let channel;
    let records = 0;
    try {
        channel = await connection.createConfirmChannel();
        for await (const page of load(env, from, to, size)) {
            // Wait for publisher confirms before reading another page.
            await Promise.all(page.map((row) => {return publish(channel, row)}));
            records += page.length;
        }
    } finally {
        try {
            await channel?.close();
        } finally {
            await connection.close();
        }
    }
    return { from, to, records };
}
