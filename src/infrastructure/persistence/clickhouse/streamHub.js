/**
 * Shared ClickHouse stream hub.
 *
 * Coalesces many topic watchers on one connection into one batched poll per
 * step interval, cutting ClickHouse CPU from O(sensors) to O(pulses).
 *
 * @example
 *   const hub = clickhouseStreamHub(connection);
 *   const sub = hub.watch('m1/V', since, 1000, onRow, { unit: 'V', clock });
 *   sub.cancel();
 */
import pollTopicCursors from './pollTopicCursors.js';

const hubs = new WeakMap();

function defaultSchedule(step, fn) {
    const timer = setInterval(fn, step);
    return () => {
        clearInterval(timer);
    };
}

function parseTimestamp(ts) {
    return new Date(`${ts}Z`);
}

function bucketKey(step) {
    return String(step);
}

function createBucket(hub, step, clock) {
    return {
        step,
        clock,
        watchers: new Map(),
        stop: hub.schedule(step, () => {
            return hub.pulse(step);
        })
    };
}

function addWatcher(bucket, topic, watcher) {
    if (!bucket.watchers.has(topic)) {
        bucket.watchers.set(topic, new Set());
    }
    bucket.watchers.get(topic).add(watcher);
}

function removeWatcher(bucket, topic, watcher) {
    const group = bucket.watchers.get(topic);
    if (!group) {
        return;
    }
    group.delete(watcher);
    if (group.size === 0) {
        bucket.watchers.delete(topic);
    }
}

function cursorsOf(bucket) {
    const oldest = new Map();
    bucket.watchers.forEach((group, topic) => {
        group.forEach((watcher) => {
            const prev = oldest.get(topic);
            if (!prev || watcher.lastTs.getTime() < prev.getTime()) {
                oldest.set(topic, watcher.lastTs);
            }
        });
    });
    const cursors = [];
    oldest.forEach((since, topic) => {
        cursors.push({ topic, since });
    });
    return cursors;
}

function dispatch(bucket, rows) {
    rows.forEach((row) => {
        const group = bucket.watchers.get(row.topic);
        if (!group) {
            return;
        }
        const timestamp = parseTimestamp(row.ts);
        group.forEach((watcher) => {
            if (timestamp.getTime() <= watcher.lastTs.getTime()) {
                return;
            }
            watcher.callback({ timestamp, value: row.value, unit: watcher.unit });
            watcher.lastTs = timestamp;
        });
    });
}

function buildHub(connection, schedule) {
    const buckets = new Map();
    const hub = {
        schedule,
        async pulse(step) {
            const bucket = buckets.get(bucketKey(step));
            if (!bucket || bucket.watchers.size === 0) {
                return;
            }
            try {
                const rows = await pollTopicCursors(
                    connection,
                    cursorsOf(bucket),
                    bucket.clock()
                );
                dispatch(bucket, rows);
            } catch (err) {
                console.error( // eslint-disable-line no-console
                    `Stream batch failed on ${connection.url()}:`,
                    err.message
                );
            }
        },
        watch(topic, since, step, callback, options) {
            const key = bucketKey(step);
            if (!buckets.has(key)) {
                buckets.set(key, createBucket(hub, step, options.clock || (() => {
                    return new Date();
                })));
            }
            const bucket = buckets.get(key);
            const watcher = { lastTs: since, callback, unit: options.unit };
            addWatcher(bucket, topic, watcher);
            return {
                cancel() {
                    removeWatcher(bucket, topic, watcher);
                    if (bucket.watchers.size === 0) {
                        bucket.stop();
                        buckets.delete(key);
                    }
                }
            };
        }
    };
    return hub;
}

/**
 * Creates a stream hub for connection, replacing any previous hub.
 *
 * @param {object} connection - shared ClickHouse connection
 * @param {function} [schedule] - (step, fn) => cancel, for tests
 * @returns {object} hub with watch(topic, since, step, callback, options)
 */
export function createClickhouseStreamHub(connection, schedule) {
    const hub = buildHub(connection, schedule || defaultSchedule);
    hubs.set(connection, hub);
    return hub;
}

/**
 * Returns the shared hub for connection, creating one if needed.
 *
 * @param {object} connection - shared ClickHouse connection
 * @returns {object} hub with watch(topic, since, step, callback, options)
 */
export default function clickhouseStreamHub(connection) {
    if (!hubs.has(connection)) {
        return createClickhouseStreamHub(connection, defaultSchedule);
    }
    return hubs.get(connection);
}
