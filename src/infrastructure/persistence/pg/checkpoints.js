import segmentStatePg from './segments.js';
import cycleLookback from '../../../domain/timeline/cycleLookback.js';

function parseJsonField(raw) {
    if (!raw) {
        return null;
    }
    return JSON.parse(raw);
}

function segmentItem(row, machineId) {
    if (!row) {
        return null;
    }
    return {
        machine: machineId,
        name: row.name,
        start: new Date(row.start_time).getTime() / 1000,
        end: new Date(row.end_time).getTime() / 1000,
        duration: row.duration,
        tags: parseJsonField(row.tags),
        options: parseJsonField(row.options),
        properties: parseJsonField(row.properties)
    };
}

function segmentAt(pool, machineId, startEpoch) {
    const segments = segmentStatePg(pool);
    const start = new Date(startEpoch * 1000);
    return segments.rowAt(machineId, start).then((row) => {
        return segmentItem(row, machineId);
    });
}

function replayCursor(pool, machineId) {
    return pool.query(
        `WITH closed AS (
            SELECT MAX(EXTRACT(EPOCH FROM end_time)) AS ts
            FROM segments
            WHERE machine = $1 AND duration > 0
        ),
        pending AS (
            SELECT MAX(EXTRACT(EPOCH FROM start_time)) AS ts
            FROM segments
            WHERE machine = $1 AND duration = 0
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
        `SELECT machine, name,
                EXTRACT(EPOCH FROM start_time) AS start,
                EXTRACT(EPOCH FROM end_time) AS end
         FROM segments
         WHERE duration = 0`
    ).then((result) => {
        return result.rows.map((row) => {
            return {
                machine: row.machine,
                name: row.name,
                start: Number(row.start),
                end: Number(row.end)
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
        },
        segment(machineId, startEpoch) {
            return segmentAt(pool, machineId, startEpoch);
        },
        cyclePrior(machineId, beforeEpoch, resetTags) {
            return pool.query(
                `SELECT name, start_time, end_time, duration, tags, options, properties
                 FROM segments
                 WHERE machine = $1 AND start_time < $2
                 ORDER BY start_time DESC`,
                [machineId, new Date(beforeEpoch * 1000)]
            ).then((result) => {
                return cycleLookback(result.rows, resetTags).map((row) => {
                    return segmentItem(row, machineId);
                });
            });
        }
    };
}
