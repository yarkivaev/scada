import deadline from '../../streams/deadline.js';

function attempt(action) {
    try { return Promise.resolve(action()); } catch (error) { return Promise.reject(error); }
}
/** Every cleanup runs even if another component throws or cannot drain. */
export default async function stopSegmentPipeline(source, collector, silence, pool, timeoutMs = 5000) {
    const end = performance.now() + timeoutMs;
    const stops = [attempt(() => {return source.stop()}), attempt(() => {return collector.abort?.()}),
        attempt(() => {return silence.stop()}), attempt(() => {return collector.stop?.()})];
    try {
        const results = await deadline(Promise.allSettled(stops), timeoutMs, 'Segment pipeline stop');
        const failed = results.find(result => {return result.status === 'rejected'});
        if (failed) { throw failed.reason; }
    } finally {
        await deadline(attempt(() => {return pool.end()}), Math.max(1, end - performance.now()), 'Segment pool close');
    }
}
