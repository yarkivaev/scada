import deadline from './deadline.js';

/** Bounded reusable AMQP connections, independent of collector task lifecycles. */
export default function deliverySessions(factory, timeoutMs = 10000) {
    const sessions = new Map();
    return {
        async write(descriptor, event) {
            const key = JSON.stringify(descriptor);
            let sink = sessions.get(key);
            if (!sink) {
                if (sessions.size >= 64) { throw new Error('Delivery session capacity exceeded'); }
                sink = factory(descriptor); sessions.set(key, sink);
                try { await deadline(() => { return sink.start?.(); }, timeoutMs); } catch (error) {
                    sessions.delete(key);
                    await deadline(() => { return sink.stop?.(); }, timeoutMs).catch(() => {
                        // Original failure propagates.
                    });
                    throw error;
                }
            }
            await deadline(() => { return sink.write([event]); }, timeoutMs);
        },
        async close() {
            await Promise.allSettled(Array.from(sessions.values(), (sink) => { return deadline(() => { return sink.stop?.(); }, timeoutMs); }));
            sessions.clear();
        }
    };
}
