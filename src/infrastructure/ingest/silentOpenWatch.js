/**
 * Periodic wall-clock sweep that closes stale open segments without waiting for STOMP.
 *
 * @param {object} closer - closeSilentOpen result with close(budgetSeconds)
 * @param {number} budget - silence budget in seconds
 * @param {object} options - intervalMs for sweep period
 * @returns {object} watch with start() and stop()
 *
 * @example
 *   const watch = silentOpenWatch(closer, 30, { intervalMs: 5000 });
 *   await watch.start();
 */
export default function silentOpenWatch(closer, budget, options) {
    if (!closer || typeof closer.close !== 'function') {
        throw new Error('Closer must have a close() method');
    }
    if (typeof budget !== 'number' || !(budget > 0)) {
        throw new Error(`Budget must be a positive number: ${budget}`);
    }
    const intervalMs = options && options.intervalMs ? options.intervalMs : 5000;
    const gate = { busy: false };
    let timer;
    let active = false;
    function claim() {
        const free = !gate.busy;
        gate.busy = true;
        return free;
    }
    function release() {
        gate.busy = false;
    }
    async function tick() {
        if (!claim()) {
            return;
        }
        try {
            await closer.close(budget);
        } catch {
            /* next tick retries */
        }
        release();
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
