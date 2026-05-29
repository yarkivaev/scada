import pubsub from '../../../domain/shared/pubsub.js';
import timeline from '../../../domain/timeline/timeline.js';

/**
 * In-memory timeline bundle for tests (read + write + pubsub).
 *
 * @returns {object} timeline with list, retag, pending, respond, stream
 *
 * @example
 *   const tl = memoryTimelineFull();
 *   await tl.retag(new Date(), ['on'], {});
 */
export default function memoryTimelineFull() {
    const items = [];
    const pending = [];
    const bus = pubsub();
    const read = {
        list(range) {
            if (!range) {
                return items.slice();
            }
            return items.filter((item) => {
                if (range.from && item.end_time < new Date(range.from)) {
                    return false;
                }
                if (range.to && item.start_time > new Date(range.to)) {
                    return false;
                }
                return true;
            });
        },
        rowAt(start) {
            return items.find((item) => {
                return item.start_time.getTime() === start.getTime();
            }) || null;
        },
        pending() {
            return pending.filter((item) => {
                return !item.resolved;
            });
        }
    };
    const write = {
        retag(start, tags, properties) {
            const found = items.find((item) => {
                return item.start_time.getTime() === start.getTime();
            });
            if (found) {
                found.tags = tags;
                found.properties = properties;
                delete found.options;
            }
        },
        respond(start, tags, properties) {
            const found = pending.find((item) => {
                return item.start_time.getTime() === start.getTime();
            });
            if (found) {
                found.resolved = true;
                found.tags = tags;
                found.properties = properties;
            }
        }
    };
    const composed = timeline(read, write);
    const originalStream = composed.stream;
    return {
        list: composed.list,
        rowAt: composed.rowAt,
        pending: composed.pending,
        retag: composed.retag,
        respond: composed.respond,
        stream(callback) {
            const sub = originalStream(callback);
            const busSub = bus.stream(callback);
            return {
                cancel() {
                    sub.cancel();
                    busSub.cancel();
                }
            };
        },
        seed(segment) {
            items.push(segment);
            bus.emit({ type: 'created', segment });
        },
        seedPending(request) {
            pending.push({ ...request, resolved: false });
            bus.emit({ type: 'created', request });
        }
    };
}
