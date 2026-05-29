function parseTimestamp(ts) {
    return ts instanceof Date ? ts : new Date(ts);
}

function pollStream(spec) {
    const { read, topic, since, step, callback, clock, unit } = spec;
    const time = clock || (() => {
        return new Date();
    });
    let lastTs = since;
    const timer = setInterval(async () => {
        try {
            const rows = await read.poll(topic, lastTs.toISOString(), time().toISOString());
            rows.forEach((row) => {
                const timestamp = parseTimestamp(row.ts);
                callback({ timestamp, value: row.value, unit });
                lastTs = timestamp;
            });
        } catch {
            /* next poll retries */
        }
    }, step);
    return {
        cancel() {
            clearInterval(timer);
        }
    };
}

/**
 * Read port adapter for PostgreSQL metrics state.
 *
 * @param {object} metrics - metrics state port from metricsStatePg
 * @returns {object} read port for metricsSensor
 */
export function pgMetricsRead(metrics) {
    return {
        async current(topic) {
            const row = await metrics.latestForTopic(topic);
            if (!row) {
                return { found: false };
            }
            return { found: true, ts: row.ts, value: row.value };
        },
        range(topic, startIso, endIso, stepMs) {
            return metrics.rangeForTopic(topic, startIso, endIso, stepMs);
        },
        poll(topic, afterIso, untilIso) {
            return metrics.pollTopic(topic, afterIso, untilIso);
        }
    };
}

/**
 * Sensor reading metrics through a generic read port.
 *
 * @param {object} read - port with current, range, poll
 * @param {string} topic - metrics topic key
 * @param {string} displayName - label
 * @param {string} unit - unit string
 * @returns {object} sensor with name current measurements stream
 */
export default function metricsSensor(read, topic, displayName, unit) {
    return {
        name() {
            return displayName;
        },
        async current() {
            const row = await read.current(topic);
            if (!row.found) {
                return { found: false };
            }
            return {
                found: true,
                timestamp: parseTimestamp(row.ts),
                value: row.value,
                unit
            };
        },
        async measurements(range, step) {
            const rows = await read.range(
                topic,
                range.start.toISOString(),
                range.end.toISOString(),
                step
            );
            return rows.map((row) => {
                return {
                    timestamp: parseTimestamp(row.ts),
                    value: row.value,
                    unit
                };
            });
        },
        stream(since, step, callback, clock) {
            return pollStream({ read, topic, since, step, callback, clock, unit });
        }
    };
}

/**
 * Sensor reading metrics from PostgreSQL metrics table in-process.
 *
 * @param {object} metrics - metrics state port with latestForTopic, rangeForTopic, pollTopic
 * @param {string} topic - metrics topic key
 * @param {string} displayName - label
 * @param {string} unit - unit string
 * @returns {object} sensor with name current measurements stream
 */
export function pgMetricsSensor(metrics, topic, displayName, unit) {
    return metricsSensor(pgMetricsRead(metrics), topic, displayName, unit);
}
