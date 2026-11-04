import { randomUUID } from 'node:crypto';
import taskState from './taskState.js';
import deadline from './deadline.js';
import budgetedSink from './budgetedSink.js';

// eslint-disable-next-line max-statements
function validate(spec, ports) {
    if (!ports.sources.has(spec.source?.type)) { throw new TypeError('Unknown stream source'); }
    if (!Array.isArray(spec.sinks) || !spec.sinks.length || spec.sinks.some((sink) => { return !ports.sinks.has(sink.type); })) {
        throw new TypeError('Unknown stream sink');
    }
    if (!['live', 'durable', 'spooled'].includes(spec.delivery)) { throw new TypeError('Explicit delivery policy required'); }
    if (spec.delivery === 'spooled' && spec.sinks.some((sink) => { return sink.type !== 'amqp'; })) { throw new TypeError('Spooled delivery requires AMQP'); }
    const names = spec.sinks.map((sink, index) => { return sink.id ?? String(index); });
    if (new Set(names).size !== names.length) { throw new TypeError('Duplicate sink id'); }
    if (spec.delivery === 'durable' && spec.sinks.some((sink) => { return sink.type === 'mqtt' && ![1, 2].includes(sink.options?.qos); })) {
        throw new TypeError('Durable MQTT delivery requires QoS 1 or 2');
    }
    if (spec.transform && !ports.transforms.has(spec.transform)) { throw new TypeError('Unknown stream transform'); }
    if (spec.delivery === 'durable' && (!spec.stateVersion || !spec.compatibilityKey)) {
        throw new TypeError('Durable stream requires stateVersion and compatibilityKey');
    }
}
async function durable(bag, value) {
    const {pending} = bag.state.snapshot();
    if (pending?.event.eventId === value.eventId && JSON.stringify(pending.event) !== JSON.stringify(value)) {
        throw new Error('Conflicting event identity');
    }
    await bag.state.resume(bag.sinks);
    if (pending?.event.eventId !== value.eventId) { await bag.state.deliver(value, bag.sinks, value.checkpoint ?? null); }
}
// eslint-disable-next-line max-statements
async function accept(bag, record) {
    bag.context.signal.throwIfAborted();
    if (bag.stopped) { throw new Error('Stream stopped'); }
    const release = bag.context.budget.reserve({ bytes: Buffer.byteLength(JSON.stringify(record)), records: 1 });
    try {
        const value = bag.transform ? await bag.transform(record) : record;
        bag.context.signal.throwIfAborted();
        bag.context.report?.({ state: 'running', read: 1 });
        if (value === null) { return; }
        if (bag.queued) {
            await bag.context.deliveryQueue.accept({ ...value, eventId: value.eventId ?? randomUUID() }, bag.destinations);
        } else if (bag.state) { await durable(bag, value); }
        else {
            await Promise.all(Object.values(bag.sinks).map((sink) => {
                bag.context.signal.throwIfAborted();
                return deadline(() => { return sink.write([value], { signal: bag.context.signal }); }, bag.timeoutMs);
            }));
        }
        bag.context.report?.({ state: 'running', delivered: 1 });
    } finally { release(); }
}
function current(bag) {
    bag.context.signal.throwIfAborted();
    if (bag.stopped) { throw new Error('Stream stopped'); }
}
async function restore(bag) {
    if (!bag.state) { return; }
    const {checkpoint} = bag.state.snapshot();
    if (checkpoint !== null && typeof bag.source.restore !== 'function') { throw new Error('Durable source cannot restore its checkpoint'); }
    if (typeof bag.source.restore === 'function') { await bag.source.restore(checkpoint); }
}
async function start(bag) {
    if (bag.state) { await bag.state.open(); }
    current(bag);
    await Promise.all(Object.values(bag.sinks).map((sink) => { return sink.start?.(); }));
    current(bag);
    if (bag.state) { await bag.state.resume(bag.sinks); }
    current(bag);
    await restore(bag);
    current(bag);
    await bag.source.start();
}
async function stop(bag) {
    bag.stopped = true;
    // A failed source cleanup must not be mistaken for a completed release.
    try { await bag.source.stop(); } finally {
        await Promise.all(Object.values(bag.sinks).map((sink) => { return sink.stop?.(); }));
    }
}
function recipient(spec, stream, context, ports) {
    const sink = ports.sinks.get(spec.type)(spec, context);
    if (stream.delivery !== 'durable' || spec.type !== 'amqp') { return sink; }
    return {
        start() { return sink.start?.(); },
        stop() { return sink.stop?.(); },
        write(records, options) {
            return sink.write(records.map((record) => { return { ...record,
                options: { ...record.options, persistent: true, mandatory: true, messageId: record.eventId } }; }), options);
        }
    };
}
function create(spec, context, ports) {
    if (spec.delivery === 'durable' && !context.stateStore) { throw new TypeError('Durable stateStore required'); }
    if (spec.delivery === 'spooled' && !context.deliveryQueue) { throw new TypeError('Node deliveryQueue required'); }
    const sinks = spec.delivery === 'spooled' ? {} : Object.fromEntries(spec.sinks.map((sink, index) => {
        return [sink.id ?? String(index), budgetedSink(recipient(sink, spec, context, ports), context.budget, false)];
    }));
    const bag = { sinks, context, queued: spec.delivery === 'spooled',
        destinations: spec.sinks.map((sink, index) => { return { ...sink, id: sink.id ?? String(index) }; }), stopped: false, timeoutMs: spec.writeTimeoutMs ?? 10000,
        transform: ports.transforms.get(spec.transform),
        state: spec.delivery === 'durable' ? taskState(context.stateStore, { ...spec, taskId: context.taskId, signal: context.signal }) : null };
    bag.source = ports.sources.get(spec.source.type)(spec.source, { accept(record) { return accept(bag, record); } }, context);
    return { start() { return start(bag); }, stop() { return stop(bag); } };
}
/** One lifecycle for arbitrary registered source/transform/sink combinations. */
export default function streamTask(ports) {
    return {
        validate(spec) { validate(spec, ports); },
        resources(spec) { return spec.resources ?? []; },
        create(spec, context) { return create(spec, context, ports); }
    };
}
