const DEFAULT_INTERVAL_MS = 30000;

/**
 * Periodic sync of edge operators cache from central plant API.
 * Default interval is 30s; keeps the last successful snapshot when central is unreachable.
 *
 * @param {object} fetch - centralOperatorsFetch with pull()
 * @param {object} cache - operatorsFromCache with replace(items)
 * @param {object} [options] - intervalMs for sync period
 * @returns {object} sync with start() and stop()
 *
 * @example
 *   const sync = operatorsSync(fetch, cache, { intervalMs: 30000 });
 *   await sync.start();
 */
export default function operatorsSync(fetch, cache, options) {
    const intervalMs = options && options.intervalMs ? options.intervalMs : DEFAULT_INTERVAL_MS;
    let timer;
    let active = false;
    async function tick() {
        try {
            const items = await fetch.pull();
            cache.replace(items);
        } catch {
            /* next tick retries; stale snapshot remains */
        }
    }
    return {
        async start() {
            if (active) {
                return;
            }
            active = true;
            await tick();
            timer = setInterval(() => {
                void tick();
            }, intervalMs);
        },
        stop() {
            if (!active) {
                return;
            }
            active = false;
            clearInterval(timer);
            timer = undefined;
        }
    };
}
