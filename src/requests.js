import pubsub from './pubsub.js';

/**
 * Per-machine in-memory label request collection.
 * Stores requests for segment labeling with options for the user to choose from.
 * Supports responding to requests and streaming events via pubsub.
 *
 * @returns {object} collection with add, respond, query, stream methods
 *
 * @example
 *   const reqs = requests();
 *   reqs.add({ id: 'req-0', name: 'unknown', startTime: new Date(), endTime: new Date(), duration: 60, options: ['on', 'off'] });
 *   reqs.respond('req-0', { label: 'on' }); // marks resolved
 *   reqs.query(); // returns unresolved requests
 *   const sub = reqs.stream((e) => console.log(e));
 *   sub.cancel();
 */
export default function requests() {
    const items = [];
    const bus = pubsub();
    return {
        add(request) {
            items.push({ ...request, resolved: false });
            bus.emit({ type: 'created', request });
        },
        respond(id, body) {
            const found = items.find((r) => {
                return r.id === id && !r.resolved;
            });
            if (!found) {
                return undefined;
            }
            found.resolved = true;
            bus.emit({ type: 'resolved', request: found });
            return { id, ...body };
        },
        query() {
            return items.filter((r) => {
                return !r.resolved;
            });
        },
        stream: bus.stream
    };
}
