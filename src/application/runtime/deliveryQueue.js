import deliverySpool from '../../infrastructure/persistence/runtime/deliverySpool.js';
import deliverySessions from './deliverySessions.js';

function confirmed(event) {
    return { ...event, options: { ...event.options, persistent: true, mandatory: true, messageId: event.eventId } };
}
/* eslint max-lines-per-function: ["error", 60] */
/** Node-owned queue: removing a source does not remove its destination descriptors or receipts. */
export default function deliveryQueue(directory, options) {
    const spool = deliverySpool(directory, options);
    const sessions = deliverySessions(options.factory, options.writeTimeoutMs);
    let chain = Promise.resolve();
    const state = { pending: 0, draining: false, closed: false };
    function serialized(action) {
        if (state.pending >= (options.maxOperations ?? 32)) { return Promise.reject(new Error('Delivery operation capacity exceeded')); }
        state.pending += 1;
        const result = chain.then(action).finally(() => { state.pending -= 1; });
        chain = result.catch(() => {
            // Individual callers receive rejection; preserve serialization.
        });
        return result;
    }
    async function send(record, id) {
        if (state.closed) { throw new Error('Delivery queue closed'); }
        const descriptor = record.event.destinations.find((item) => { return item.id === id; });
        await sessions.write(descriptor, confirmed(record.event.observation));
        await serialized(() => { return spool.ack(record.event.eventId, id); });
    }

    return {
        open() { return serialized(() => { return spool.open(); }); },
        accept(event, destinations) {
            if (state.closed) { return Promise.reject(new Error('Delivery queue closed')); }
            if (!destinations?.length || destinations.some((item) => { return item.type !== 'amqp'; })) {
                return Promise.reject(new TypeError('Queued delivery requires confirmed AMQP destinations'));
            }
            // Snapshot before asynchronous I/O; callers may reuse buffers/objects.
            const envelope = JSON.parse(JSON.stringify({ eventId: event.eventId, observation: event, destinations }));
            return serialized(() => { return spool.append(envelope, destinations.map((item) => { return item.id; })); });
        },
        async drain() {
            if (state.draining || state.closed) { return { delivered: 0, failed: 0 }; }
            state.draining = true;
            const result = { delivered: 0, failed: 0 };
            try {
                const rows = await serialized(() => { return spool.pending(options.batchSize ?? 100); });
                for (const row of rows) {
                    for (const id of row.remaining) {
                        // Recipients fail independently; continue draining other destinations.
                        // eslint-disable-next-line no-await-in-loop, max-depth
                        try { await send(row, id); result.delivered += 1; } catch (error) {
                            result.failed += 1; options.onError?.(error);
                        }
                    }
                }
                return result;
            } finally { Object.assign(state, { draining: false }); }
        },
        close() { state.closed = true; return sessions.close(); },
        status() { return spool.status(); }
    };
}
