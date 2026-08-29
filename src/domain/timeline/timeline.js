/**
 * Read-only timeline port wired to a pubsub event bus.
 *
 * @param {object} read - read port with list, rowAt, pending
 * @param {object} bus - pubsub instance with stream method
 * @returns {object} timeline with list, rowAt, pending, stream
 *
 * @example
 *   const tl = timeline(pgTimeline(pool, 'm1'), bus);
 *   await tl.list({ from: '2024-01-01' });
 */
export default function timeline(read, bus) {
    return {
        list(range) {
            return read.list(range);
        },
        rowAt(start) {
            return read.rowAt(start);
        },
        pending() {
            return read.pending();
        },
        latest(kinds) {
            if (typeof read.latest !== 'function') {
                return [];
            }
            return read.latest(kinds);
        },
        stream: bus.stream
    };
}
