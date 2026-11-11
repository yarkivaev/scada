import deadline from './deadline.js';

/** Shared opening and actual settlement outlive caller deadlines; stop fences failed sessions. */
/* eslint max-lines-per-function: ["error", 100], max-statements: ["error", 25] */
export default function deliverySessions(factory, timeoutMs = 10000) {
    const sessions = new Map();
    const state = { closed: false };
    function retire(key, entry) {
        entry.closing ??= (async () => {
            if (!entry.opened) { await entry.sink.stop?.(); }
            await entry.opening.catch(() => {
                // A failed opening must still be stopped; a late successful one may own new resources.
            });
            await entry.sink.stop?.();
            await Promise.allSettled(entry.pending);
            if (sessions.get(key) === entry) { sessions.delete(key); }
        })();
        return entry.closing;
    }
    function session(key, descriptor) {
        let entry = sessions.get(key);
        if (entry?.closing) { throw new Error('Delivery session is closing'); }
        if (!entry) {
            if (sessions.size >= 64) { throw new Error('Delivery session capacity exceeded'); }
            const sink = factory(descriptor);
            entry = { sink, pending: new Set(), opened: false };
            entry.opening = Promise.resolve().then(() => { return sink.start?.(); }).finally(() => { entry.opened = true; });
            sessions.set(key, entry);
            void entry.opening.catch(() => { return retire(key, entry); }).catch(() => {
                // Failed shutdown keeps the failed opening fenced.
            });
        }
        return entry;
    }
    return {
        write(descriptor, event) {
            if (state.closed) { throw new Error('Delivery sessions closed'); }
            const key = JSON.stringify(descriptor);
            const entry = session(key, descriptor);
            const controller = new AbortController();
            const settled = entry.opening.then(() => {
                if (controller.signal.aborted || entry.closing) { throw controller.signal.reason || new Error('Delivery session is closing'); }
                return entry.sink.write([event], { signal: controller.signal });
            });
            entry.pending.add(settled);
            let completed = false;
            void settled.finally(() => { completed = true; entry.pending.delete(settled); }).catch(() => {
                // A publication rejection is independent of other confirms on this session.
            });
            const result = deadline(() => { return settled; }, timeoutMs).catch((error) => {
                if (!completed) {
                    controller.abort(error);
                    void retire(key, entry).catch(() => {
                        // Actual work and ownership remain fenced if stop cannot complete.
                    });
                }
                throw error;
            });
            return { result, settled };
        },
        close() {
            state.closed = true;
            return deadline(() => { return Promise.all(Array.from(sessions, ([key, entry]) => { return retire(key, entry); })); }, timeoutMs);
        }
    };
}
