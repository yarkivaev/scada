function replayCursor(pool, machineId) {
    return pool.query(
        `WITH closed AS (
            SELECT MAX(EXTRACT(EPOCH FROM end_time)) AS ts
            FROM segments
            WHERE machine = $1 AND end_time > start_time
        ),
        pending AS (
            SELECT MAX(EXTRACT(EPOCH FROM start_time)) AS ts
            FROM segments
            WHERE machine = $1 AND start_time = end_time
        )
        SELECT COALESCE(LEAST(closed.ts, pending.ts), pending.ts, closed.ts, 0.0) AS cursor
        FROM closed, pending`,
        [machineId]
    ).then((result) => {
        return Number(result.rows[0].cursor || 0);
    });
}

function pendingSegments(pool) {
    return pool.query(
        `SELECT machine, name, EXTRACT(EPOCH FROM start_time) AS start
         FROM segments
         WHERE start_time = end_time`
    ).then((result) => {
        return result.rows.map((row) => {
            return {
                machine: row.machine,
                name: row.name,
                start: Number(row.start)
            };
        });
    });
}

function readings(pool, topics, from) {
    if (topics.length === 0) {
        return Promise.resolve([]);
    }
    const placeholders = topics.map((item, index) => {
        return `$${index + 1}`;
    }).join(',');
    return pool.query(
        `SELECT topic, EXTRACT(EPOCH FROM ts) AS ts, value
         FROM metrics
         WHERE topic IN (${placeholders}) AND ts > to_timestamp($${topics.length + 1})
         ORDER BY ts ASC`,
        [...topics, from]
    ).then((result) => {
        return result.rows.map((row) => {
            return {
                topic: row.topic,
                timestamp: Number(row.ts),
                value: Number(row.value)
            };
        });
    });
}

export default function checkpointStatePg(pool, metricsEnabled = true) {
    return {
        replayCursor(machineId) {
            return replayCursor(pool, machineId);
        },
        pendingSegments() {
            return pendingSegments(pool);
        },
        readings(topics, from) {
            if (!metricsEnabled) {
                return Promise.resolve([]);
            }
            return readings(pool, topics, from);
        }
    };
}
