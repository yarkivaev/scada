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
                const kinds = Array.isArray(range.kinds) && range.kinds.length > 0 ? range.kinds : ['phase'];
                return items.filter((item) => {
                    if (!kinds.includes(item.kind || 'phase')) {
                        return false;
                    }
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
            },
            latest(kinds) {
                if (!Array.isArray(kinds) || kinds.length === 0) {
                    return [];
                }
                const found = new Map();
                items.forEach((item) => {
                    const track = item.kind || 'phase';
                    if (!kinds.includes(track)) {
                        return;
                    }
                    const prev = found.get(track);
                    if (!prev || item.start_time > prev.start_time) {
                        found.set(track, item);
                    }
                });
                return Array.from(found.values());
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
