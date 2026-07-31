import pubsub from '../domain/shared/pubsub.js';
import timeline from '../domain/timeline/timeline.js';
import pgTimeline from '../infrastructure/persistence/pg/timeline.js';
import memoryTimelineStore, { memoryTimelineRead } from '../infrastructure/persistence/memory/timeline.js';
import ownerTimeline from '../infrastructure/messaging/ownership/ownerTimeline.js';
import stompTimeline from '../infrastructure/messaging/stomp/timeline.js';

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

function memoryTimelinePort(store, bus) {
    const port = memoryTimelineRead(store, bus);
    return {
        list: port.list,
        rowAt: port.rowAt,
        pending: port.pending,
        stream: port.stream,
        bus,
        retag(start, tags, properties, audit) {
            const found = store.items.find((item) => {
                return item.start_time.getTime() === start.getTime();
            });
            if (found) {
                found.tags = tags;
                found.properties = properties;
                delete found.options;
            }
            bus.emit({ type: 'resolved', segment: resolvedStub(start, tags, properties), audit });
        },
        respond(requestId, body, audit) {
            const start = parseStart(requestId);
            const found = store.pending.find((item) => {
                return item.start_time.getTime() === start.getTime();
            });
            if (found) {
                found.resolved = true;
                found.tags = body.tags;
                found.properties = body.properties;
            }
            bus.emit({ type: 'resolved', request: { id: requestId, start }, audit });
            return { id: requestId, ...body };
        }
    };
}

function writePort(name, decisions, owners) {
    if (!owners) {
        return stompTimeline(decisions, name);
    }
    return ownerTimeline((id) => {
        return stompTimeline(decisions, id);
    }, owners)(name);
}

/**
 * Builds a machine timeline from PostgreSQL persistence and STOMP user decisions.
 *
 * Optional owners registry routes retag/respond to an edge HTTP plant API.
 *
 * @param {string} name - machine id
 * @param {object} options - pool, userDecisions, optional owners
 * @returns {object} timeline port with list, rowAt, pending, stream, retag, respond, bus
 *
 * @example
 *   const tl = shopWithTimeline('machine1', { pool, userDecisions, owners });
 */
export default function shopWithTimeline(name, options) {
    const { pool, userDecisions: decisions, owners } = options;
    if (pool && decisions) {
        const bus = pubsub();
        const read = pgTimeline(pool, name);
        const write = writePort(name, decisions, owners);
        const port = timeline(read, bus);
        return {
            list: port.list,
            rowAt: port.rowAt,
            pending: port.pending,
            stream: port.stream,
            bus,
            async retag(start, tags, properties, audit) {
                await write.retag(start, tags, properties, audit);
                bus.emit({ type: 'resolved', segment: resolvedStub(start, tags, properties), audit });
            },
            async respond(requestId, body, audit) {
                const start = parseStart(requestId);
                await write.respond(start, body.tags, body.properties || {}, audit);
                bus.emit({ type: 'resolved', request: { id: requestId, start }, audit });
                return { id: requestId, ...body };
            }
        };
    }
    const store = memoryTimelineStore();
    const bus = pubsub();
    return memoryTimelinePort(store, bus);
}
