import historyFold from '../domain/segment/historyFold.js';

function instant(value) {
    return new Date(value).getTime();
}

function own(folded, seg) {
    const start = instant(seg.start_time);
    const end = instant(seg.end_time);
    return folded.some((row) => {
        return instant(row.start_time) === start && instant(row.end_time) === end;
    });
}

function staleOpen(seg, stored) {
    return Number(seg.duration) === 0 && stored.some((row) => {
        return instant(row.start_time) > instant(seg.start_time);
    });
}

function overlapSql() {
    return `SELECT kind,name,start_time,end_time,duration,options,tags,properties,resolved,consumed
         FROM segments WHERE machine=$1 AND kind='phase'
           AND ((start_time<$3 AND end_time>$2) OR ($4 = 0 AND start_time>$2))`;
}

function covered(pool, machine, seg) {
    const start = seg.start_time;
    const finish = seg.end_time || seg.start_time;
    return pool.query(overlapSql(), [machine, start, finish, Number(seg.duration)]).then((result) => {
        const stored = result.rows;
        if (staleOpen(seg, stored)) {
            return true;
        }
        return !own(historyFold(stored, [seg]), seg);
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
                return undefined;
            });
        }
    };
}

/**
 * Drops STOMP timeline events whose start would not survive historyFold.
 *
 * Covered starts, stale duration-0 covers, and empty spans that fold
 * clips away never reach HMI or monitoring SSE. SELECT errors stay closed.
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
