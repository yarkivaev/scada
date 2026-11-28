import deliveryQueue from './deliveryQueue.js';
import { sinks } from './streamPorts.js';

/** Configured once per node; queue draining outlives any individual assignment. */
export default function queuedDelivery(env, secrets, supplied, store) {
    let timer;
    let stopped = false;
    let burst = 0;
    const queue = supplied ?? deliveryQueue({
        maxBytes: Number(env.COLLECTOR_QUEUE_MAX_BYTES ?? 16 * 1024 * 1024),
        maxRecords: Number(env.COLLECTOR_QUEUE_MAX_RECORDS ?? 4096),
        factory(spec) { return sinks().get(spec.type)(spec, { secrets }); },
        onError(error) { process.stderr.write(`Collector delivery delayed: ${error.message}\n`); }
    }, store);
    function nextDelay(result) {
        const status = queue.status?.();
        if (result?.delivered > 0 && status?.ready !== false && status?.drainFull && status.pending > 0) {
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
