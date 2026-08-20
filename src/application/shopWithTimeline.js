import pubsub from '../domain/shared/pubsub.js';
import timeline from '../domain/timeline/timeline.js';
import pgTimeline from '../infrastructure/persistence/pg/timeline.js';
import segmentStatePg from '../infrastructure/persistence/pg/segments.js';
import memoryTimelineStore, { memoryTimelineRead } from '../infrastructure/persistence/memory/timeline.js';
import ownerTimeline from '../infrastructure/messaging/ownership/ownerTimeline.js';
import stompTimeline from '../infrastructure/messaging/stomp/timeline.js';
import retagBody from '../infrastructure/messaging/stomp/retagBody.js';

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

function ownsLocal(owners, name) {
    if (!owners) {
        return true;
    }
    return owners.resolve(name).kind !== 'edge';
}

async function persistTags(pool, patch) {
    const state = segmentStatePg(pool);
    const tagsJson = JSON.stringify(patch.tags);
    const propsJson = JSON.stringify(patch.properties || {});
    const count = patch.resolved
        ? await state.resolveRequest(patch.machine, patch.start, tagsJson, propsJson)
        : await state.retag(patch.machine, patch.start, tagsJson, propsJson);
    if (!count) {
        throw new RangeError(`Segment ${patch.machine} at ${patch.start.toISOString()} was not updated`);
    }
    return state.rowAt(patch.machine, patch.start);
}

async function confirm(pool, patch, segments) {
    const row = await persistTags(pool, patch);
    if (segments) {
        await segments.publish(retagBody(patch.machine, row, patch.tags, patch.properties || {}));
    }
    return row;
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
    const { pool, userDecisions: decisions, owners, segments } = options;
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
                if (ownsLocal(owners, name)) {
                    await confirm(pool, {
                        machine: name,
                        start,
                        tags,
                        properties,
                        resolved: false
                    }, segments);
                }
                await write.retag(start, tags, properties, audit);
                bus.emit({ type: 'resolved', segment: resolvedStub(start, tags, properties), audit });
            },
            async respond(requestId, body, audit) {
                const start = parseStart(requestId);
                if (ownsLocal(owners, name)) {
                    await confirm(pool, {
                        machine: name,
                        start,
                        tags: body.tags,
                        properties: body.properties || {},
                        resolved: true
                    }, segments);
                }
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
