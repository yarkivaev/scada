import deliveryQueue from './deliveryQueue.js';
import { sinks } from './streamPorts.js';

/** Configured once per node; queue draining outlives any individual assignment. */
export default function queuedDelivery(env, secrets, supplied) {
    let timer;
    let stopped = false;
    let burst = 0;
    const queue = supplied ?? (env.COLLECTOR_SPOOL_DIR ? deliveryQueue(env.COLLECTOR_SPOOL_DIR, {
        maxBytes: Number(env.COLLECTOR_SPOOL_MAX_BYTES), maxRecords: Number(env.COLLECTOR_SPOOL_MAX_RECORDS ?? 100000), factory(spec) { return sinks().get(spec.type)(spec, { secrets }); },
        onError(error) { process.stderr.write(`Collector delivery delayed: ${error.message}\n`); }
    }) : undefined);
    function nextDelay(result) {
        const status = queue.status?.();
        if (result?.failed === 0 && result.delivered > 0 && status?.ready !== false && status?.drainFull && status.pending > 0) {
            burst += 1;
            const delay = burst < 4 ? 0 : 25;
            if (burst === 4) { burst = 0; }
            return delay;
        }
        burst = 0; return 1000;
    }
    async function tick() {
        if (stopped || !queue) { return; }
        let delay = 1000;
        try {
            if (queue.status?.().ready === false) { await queue.open(); }
            delay = nextDelay(await queue.drain());
        } catch (error) { burst = 0; process.stderr.write(`Collector spool: ${error.message}\n`); }
        if (!stopped) { timer = setTimeout(tick, delay); timer.unref(); }
    }
    return {
        queue,
        async open() { if (queue) { await queue.open(); timer = setTimeout(tick, 0); timer.unref(); } },
        stop() { stopped = true; clearTimeout(timer); return queue?.close?.(); }
    };
}
