import timeline from '../../../domain/timeline/timeline.js';

/**
 * In-memory segment store with timeline read port.
 *
 * @returns {object} items, pending arrays and read port
 *
 * @example
 *   const store = memoryTimelineStore();
 *   store.items.push({ name: 'on', start_time: new Date(), end_time: new Date(), duration: 0 });
 */
export default function memoryTimelineStore() {
    const items = [];
    const pending = [];
    return {
        items,
        pending,
        read: {
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
        }
    };
}

/**
 * Builds in-memory timeline read port wired to a pubsub bus.
 *
 * @param {object} store - memoryTimelineStore instance
 * @param {object} bus - pubsub instance
 * @returns {object} timeline with list, rowAt, pending, stream
 */
export function memoryTimelineRead(store, bus) {
    return timeline(store.read, bus);
}
