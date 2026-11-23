function tagText(tags) {
    if (tags === undefined || tags === null || tags === '') {
        return '[]';
    }
    return typeof tags === 'string' ? tags : JSON.stringify(tags);
}

function splitOf(seg) {
    const raw = seg.properties;
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
    return text.includes('"split_of"');
}

function covered(pool, machine, seg) {
    if (splitOf(seg)) {
        return Promise.resolve(false);
    }
    const tags = tagText(seg.tags);
    return pool.query(
        `SELECT 1 FROM segments
         WHERE machine=$1 AND kind='phase'
           AND (
             (name=$2
              AND CASE WHEN coalesce(tags, '') IN ('', '[]') THEN '[]' ELSE tags END
                = CASE WHEN coalesce($3, '') IN ('', '[]') THEN '[]' ELSE $3 END
              AND coalesce(properties, '') NOT LIKE '%"split_of"%'
              AND $4::timestamptz > start_time
              AND $4::timestamptz < end_time)
             OR (coalesce($5, 0) = 0 AND start_time > $4::timestamptz)
             OR (coalesce($3, '') IN ('', '[]')
                 AND name=$2
                 AND coalesce(tags, '') NOT IN ('', '[]')
                 AND $4::timestamptz < end_time
                 AND start_time < $6::timestamptz)
           )
         LIMIT 1`,
        [machine, seg.name, tags, seg.start_time, Number(seg.duration), seg.end_time || seg.start_time]
    ).then((result) => {
        return result.rowCount > 0;
    });
}

function gatedBus(bus, pool, machine) {
    return {
        emit(event) {
            const seg = event && event.segment;
            if (!seg) {
                bus.emit(event);
                return;
            }
            covered(pool, machine, seg).then((skip) => {
                if (!skip) {
                    bus.emit(event);
                }
            }).catch(() => {
                bus.emit(event);
            });
        }
    };
}

/**
 * Drops STOMP timeline events that Postgres would refuse to store.
 *
 * Covered same-name starts, stale duration-0 covers, and untagged
 * offs that overlap a tagged host never reach HMI or monitoring SSE.
 *
 * @param {object} buses - machine id to timeline bus
 * @param {object} pool - postgres pool with query()
 * @returns {object} buses that skip unpersisted segment events
 * @example
 *   stompTimelineSegments(source, gateTimelineBuses(buses, pool));
 */
export default function gateTimelineBuses(buses, pool) {
    if (!pool) {
        return buses;
    }
    const gated = {};
    for (const [id, bus] of Object.entries(buses)) {
        gated[id] = gatedBus(bus, pool, id);
    }
    return gated;
}
