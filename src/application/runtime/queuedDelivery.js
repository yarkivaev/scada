import deliveryQueue from './deliveryQueue.js';
import { sinks } from './streamPorts.js';

/** Configured once per node; queue draining outlives any individual assignment. */
export default function queuedDelivery(env, secrets, supplied) {
    let timer;
    let stopped = false;
    const queue = supplied ?? (env.COLLECTOR_SPOOL_DIR ? deliveryQueue(env.COLLECTOR_SPOOL_DIR, {
        maxBytes: Number(env.COLLECTOR_SPOOL_MAX_BYTES), maxRecords: Number(env.COLLECTOR_SPOOL_MAX_RECORDS ?? 100000), factory(spec) { return sinks().get(spec.type)(spec, { secrets }); },
        onError(error) { process.stderr.write(`Collector delivery delayed: ${error.message}\n`); }
    }) : undefined);
    async function tick() {
        if (stopped || !queue) { return; }
        try { await queue.drain(); } catch (error) { process.stderr.write(`Collector spool: ${error.message}\n`); }
        if (!stopped) { timer = setTimeout(tick, 1000); timer.unref(); }
    }
    return {
        queue,
        async open() { if (queue) { await queue.open(); timer = setTimeout(tick, 0); timer.unref(); } },
        stop() { stopped = true; clearTimeout(timer); return queue?.close?.(); }
    };
}
