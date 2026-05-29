import pubsub from '../shared/pubsub.js';

function parseStart(requestId) {
    const raw = decodeURIComponent(String(requestId));
    const start = new Date(raw);
    if (Number.isNaN(start.getTime())) {
        throw new RangeError(`Invalid request start time ${raw}`);
    }
    return start;
}

function resolvedStub(start, tags, properties) {
    return {
        name: '',
        start_time: start,
        end_time: start,
        duration: 0,
        tags: JSON.stringify(tags),
        properties: JSON.stringify(properties)
    };
}

/**
 * Composes PG read port and STOMP write port with local pubsub events.
 *
 * @param {object} pg - pgTimeline instance
 * @param {object} stomp - stompTimeline instance
 * @returns {object} timeline with list, retag, pending, respond, stream
 *
 * @example
 *   const tl = timeline(pgTimeline(pool, 'icht1'), stompTimeline(decisions, 'icht1'));
 *   await tl.list({ from: '2024-01-01' });
 */
export default function timeline(pg, stomp) {
    const bus = pubsub();
    return {
        list(range) {
            return pg.list(range);
        },
        rowAt(start) {
            return pg.rowAt(start);
        },
        pending() {
            return pg.pending();
        },
        async retag(start, tags, properties) {
            await stomp.retag(start, tags, properties);
            bus.emit({ type: 'resolved', segment: resolvedStub(start, tags, properties) });
        },
        async respond(requestId, body) {
            const start = parseStart(requestId);
            await stomp.respond(start, body.tags, body.properties || {});
            bus.emit({ type: 'resolved', request: { id: requestId, start } });
            return { id: requestId, ...body };
        },
        stream: bus.stream
    };
}
