import deadline from '../../streams/deadline.js';
import segmentBatchPolicy from './segmentBatchPolicy.js';

function notify(callback, value) {
    try { callback?.(value); } catch {
        // Observers cannot change commit or fencing semantics.
    }
}
function rejectEntries(entries, error) {
    for (const entry of entries) {
        for (const receipt of entry.receipts) {
            if (!receipt.done) { receipt.done = true;receipt.reject(error); }
        }
    }
}
function abort(state, error) {
    if (state.stopped) { return; }
    state.stopped = true;
    for (const lane of state.lanes.values()) {
        for (const packet of lane.packets) { clearTimeout(packet.timer);rejectEntries(packet.entries, error); }
        lane.packets = [];
    }
    for (const packet of state.inflight) { rejectEntries(packet.entries, error); }
    state.ready = [];
    notify(state.onAbort, error);
}
function fail(state, error) {
    if (state.failed || state.stopped) { return; }
    state.failed = error;abort(state, error);notify(state.onFatal, error);
}
function ackReceipt(state, receipt) {
    if (!receipt.done) {
        receipt.done = true;
        try { if (!state.stopped) { receipt.settle.ack(); } }
        catch (error) { fail(state, error); }
        receipt.resolve();
    }
}
function acknowledge(state, entries) {
    for (const entry of entries) { entry.receipts.forEach(receipt => { ackReceipt(state, receipt); }); }
}
function nackReceipt(state, receipt, error) {
    if (!receipt.done) {
        receipt.done = true;
        try { if (!state.stopped) { receipt.settle.nack(!(state.deadLetter && error.permanent)); } }
        catch (failure) { fail(state, failure); }
        receipt.reject(error);
    }
}
function refuse(state, entry, error) { entry.receipts.forEach(receipt => { nackReceipt(state, receipt, error); }); }
function completedKeys(record) {
    const rows = record.type === 'split-family' ? record.pieces : [record];
    return rows.filter(row => {return ['segment', 'split'].includes(row.type) && row.duration > 0})
        .map(row => {return `${row.machine}\0${row.kind}\0${row.start_time}`});
}
function queueReady(state, lane) {
    if (!state.stopped && !lane.running && !lane.queued && lane.packets[0]?.ready) {
        lane.queued = true;state.ready.push(lane);state.pump();
    }
}
function ready(state, lane, packet, reason) {
    if (state.stopped || packet.ready) { return; }
    packet.ready = true;packet.reason = reason;clearTimeout(packet.timer);queueReady(state, lane);
}
function packetFor(state, lane, bytes) {
    let packet = lane.packets.at(-1);
    if (packet && !packet.ready && packet.bytes + bytes > state.policy.maxBytes) { ready(state, lane, packet, 'bytes'); }
    packet = lane.packets.at(-1);
    if (!packet || packet.ready) {
        packet = { entries: [], messages: 0, bytes: 0, completed: new Set(), ready: false, createdAt: Date.now() };
        const pending = packet;
        packet.timer = setTimeout(() => { ready(state, lane, pending, 'age'); }, state.policy.maxWaitMs);
        lane.packets.push(packet);
    }
    return packet;
}
function append(state, lane, input, receipt) {
    const packet = packetFor(state, lane, input.bytes);
    packet.entries.push({ record: input.record, receipts: [receipt] });
    packet.messages += 1;packet.bytes += input.bytes;
    for (const key of completedKeys(input.record)) { packet.completed.add(key); }
    if (packet.messages >= state.policy.maxMessages) { ready(state, lane, packet, 'messages'); }
    else if (packet.bytes >= state.policy.maxBytes) { ready(state, lane, packet, 'bytes'); }
    else if (state.policy.completedSegments > 0 && packet.completed.size >= state.policy.completedSegments) { ready(state, lane, packet, 'segments'); }
}
async function persist(state, entries, packet) {
    const start = Date.now();
    const result = await state.write(entries.map(entry => {return entry.record}));
    acknowledge(state, entries);
    notify(state.onBatch, { committed: true, messages: entries.reduce((sum, entry) => {return sum + entry.receipts.length}, 0),
        records: entries.length, durationMs: Date.now() - start, waitMs: start - packet.createdAt,
        reason: packet.reason, sqlCalls: result?.sqlCalls ?? 0 });
}
async function persistOne(state, entry, packet) {
    if (state.stopped) { throw state.failed ?? new Error('Segment batches stopped'); }
    try { await persist(state, [entry], packet); }
    catch (failure) {
        if (!failure.permanent) { throw failure; }
        refuse(state, entry, failure);
    }
}
async function runPacket(state, packet) {
    try { await persist(state, packet.entries, packet); }
    catch (error) {
        if (!error.permanent || state.stopped) { throw error; }
        notify(state.onBatch, { committed: false, messages: packet.messages, records: packet.entries.length, reason: 'rollback' });
        // Confirmed permanent failure: isolate the bad command after the batch rollback.
        for (const entry of packet.entries) {
            // eslint-disable-next-line no-await-in-loop
            await persistOne(state, entry, packet);
        }
    }
}
function startPacket(state, lane) {
    const packet = lane.packets.shift();
    lane.running = true;state.active += 1;state.inflight.add(packet);
    const task = Promise.resolve().then(() => { return runPacket(state, packet); }).catch(error => { fail(state, error); }).finally(() => {
        state.active -= 1;lane.running = false;state.tasks.delete(task);state.inflight.delete(packet);
        if (lane.packets.length === 0) { state.lanes.delete(lane.machine); }
        else { queueReady(state, lane); }
        state.pump();
    });
    state.tasks.add(task);
}
function pump(state) {
    while (!state.stopped && state.active < state.policy.concurrency && state.ready.length > 0) {
        const lane = state.ready.shift();lane.queued = false;
        if (!lane.running && lane.packets[0]?.ready) { startPacket(state, lane); }
    }
}

/** Bounded FIFO machine lanes; each accept retains its lease until commit or rejection. */
export default function segmentBatch(write, options = {}) {
    const { prefetch = 32, onFatal, onAbort, onBatch, deadLetter = false, stopTimeoutMs = 5000, ...settings } = options;
    const policy = segmentBatchPolicy(settings);
    if (!Number.isSafeInteger(prefetch) || prefetch < 1) { throw new TypeError('prefetch must be a positive integer'); }
    policy.maxMessages = Math.min(policy.maxMessages, prefetch);
    const state = { policy, write, onFatal, onAbort, onBatch, deadLetter,
        lanes: new Map(), ready: [], active: 0, tasks: new Set(), inflight: new Set(), stopped: false, failed: null };
    state.pump = () => { pump(state); };
    return {
        accept(input) {
            if (state.stopped) { return Promise.reject(state.failed ?? new Error('Segment batches stopped')); }
            return new Promise((resolve, reject) => {
                const receipt = { settle: input.settle, resolve, reject, done: false };
                let lane = state.lanes.get(input.record.machine);
                if (!lane) { lane = { machine: input.record.machine, packets: [], running: false, queued: false };state.lanes.set(lane.machine, lane); }
                append(state, lane, input, receipt);
            });
        },
        abort(error = new Error('Segment batches stopped')) { abort(state, error); },
        stop() {
            abort(state, new Error('Segment batches stopped'));
            return deadline(Promise.allSettled([...state.tasks]), stopTimeoutMs, 'Segment batch stop');
        }
    };
}
