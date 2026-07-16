const DEFAULT_INTERVAL_MS = 30000;

async function refresh(source, provider) {
    const items = await source.pull();
    provider.replace(items);
    if (typeof source.enabled !== 'function' || typeof provider.permit !== 'function') {
        return;
    }
    await provider.permit(await source.enabled());
}

/**
 * Periodic sync of edge operators cache from central plant API.
 * Default interval is 30s; keeps the last successful snapshot when central is unreachable.
 * Also copies the registration enabled flag when source.enabled and provider.permit exist.
 *
 * @param {object} source - centralOperators with pull() and optional enabled()
 * @param {object} provider - operators with replace(items) and optional permit(flag)
 * @param {object} [options] - intervalMs for sync period
 * @returns {object} sync with start() and stop()
 *
 * @example
 *   const sync = operatorsSync(source, provider, { intervalMs: 30000 });
 *   await sync.start();
 */
export default function operatorsSync(source, provider, options) {
    const intervalMs = options && options.intervalMs ? options.intervalMs : DEFAULT_INTERVAL_MS;
    let timer;
    let active = false;
    async function tick() {
        try {
            await refresh(source, provider);
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
