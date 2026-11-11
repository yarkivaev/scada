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
    async function session(key, descriptor, signal) {
        while (!sessions.has(key) && sessions.size >= 64) {
            const idle = [...sessions].find(([, item]) => { return item.opened && !item.closing && item.reserved === 0 && item.pending.size === 0; });
            if (!idle) { throw new Error('Delivery session capacity exceeded'); }
            // Evict only actually settled sessions; never release active publication reservations.
            // eslint-disable-next-line no-await-in-loop
            await retire(...idle);
        }
        if (state.closed || signal.aborted) { throw signal.reason || new Error('Delivery sessions closed'); }
        let entry = sessions.get(key);
        if (entry?.closing) { throw new Error('Delivery session is closing'); }
        if (!entry) {
            if (sessions.size >= 64) { throw new Error('Delivery session capacity exceeded'); }
            const sink = factory(descriptor);
            entry = { sink, pending: new Set(), opened: false, reserved: 0 };
            entry.opening = Promise.resolve().then(() => { return sink.start?.(); }).finally(() => { entry.opened = true; });
            sessions.set(key, entry);
            void entry.opening.catch(() => { return retire(key, entry); }).catch(() => {
                // Failed shutdown keeps the failed opening fenced.
            });
        }
        entry.reserved += 1;
        sessions.delete(key); sessions.set(key, entry);
        return entry;
    }
    return {
        write(descriptor, event) {
            if (state.closed) { throw new Error('Delivery sessions closed'); }
            const key = JSON.stringify(descriptor);
            const controller = new AbortController();
            let entry;
            const settled = session(key, descriptor, controller.signal).then(current => {
                entry = current; entry.pending.add(settled); entry.reserved -= 1;
                return entry.opening.then(() => {
                    if (controller.signal.aborted || entry.closing) { throw controller.signal.reason || new Error('Delivery session is closing'); }
                    return entry.sink.write([event], { signal: controller.signal });
                });
            });
            let completed = false;
            void settled.finally(() => { completed = true; entry?.pending.delete(settled); }).catch(() => {
                // A publication rejection is independent of other confirms on this session.
            });
            const result = deadline(() => { return settled; }, timeoutMs).catch((error) => {
                if (!completed) {
                    controller.abort(error);
                    void (entry ? retire(key, entry) : Promise.resolve()).catch(() => {
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
