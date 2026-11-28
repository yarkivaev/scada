const timestamp = "to_char(ts AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US')";

async function finish(state, command) {
    const { client } = state;
    if (!client) { return; }
    state.client = undefined;
    let fault;
    try {
        await client.query(command);
    } catch (error) {
        fault = error;
        throw error;
    } finally {
        client.release(fault);
    }
}

async function declare(pool, state, topic, upper, from) {
    const client = await pool.connect();
    Object.assign(state, { client, topic });
    try {
        await client.query('BEGIN READ ONLY');
        await client.query(
            `DECLARE telemetry_rows NO SCROLL CURSOR FOR SELECT topic,${timestamp} AS ts,value
            FROM metrics WHERE topic=$1 AND ts >= $3::timestamptz AND ts <= $2::timestamptz
            ORDER BY metrics.ts,float8send(value)`,
            [topic, `${upper}+00`, from]
        );
    } catch (error) {
        await finish(state, 'ROLLBACK');
        throw error;
    }
}

/** Read a bounded snapshot of each topic, retaining physical duplicates and exact timestamps. */
export default function postgresTelemetrySource(pool, { from = '1970-01-01T00:00:00Z' } = {}) {
    const state = { client: undefined, topic: undefined };
    return {
        async nextTopic(after) {
            const sql = after === null ? 'SELECT topic FROM metrics ORDER BY topic LIMIT 1'
                : 'SELECT topic FROM metrics WHERE topic > $1 ORDER BY topic LIMIT 1';
            const result = await pool.query(sql, after === null ? [] : [after]);
            return result.rows[0]?.topic ?? null;
        },
        async upper(topic) {
            const result = await pool.query(`SELECT ${timestamp} AS ts FROM metrics WHERE topic=$1 ORDER BY metrics.ts DESC LIMIT 1`, [topic]);
            return result.rows[0]?.ts ?? null;
        },
        async page(topic, _after, upper, size) {
            if (!Number.isSafeInteger(size) || size < 1 || size > 100000) { throw new RangeError('Invalid telemetry page size'); }
            if (!state.client) { await declare(pool, state, topic, upper, from); }
            if (state.topic !== topic) { throw new Error('Source cursor belongs to another topic'); }
            try {
                const result = await state.client.query(`FETCH FORWARD ${size} FROM telemetry_rows`);
                if (result.rows.length === 0) { await finish(state, 'COMMIT'); }
                return result.rows;
            } catch (error) {
                await finish(state, 'ROLLBACK');
                throw error;
            }
        },
        close() { return finish(state, 'ROLLBACK'); }
    };
}
