/**
 * Returns the per-machine lane state, creating it when missing.
 *
 * @param {Map} lanes - machine → lane map
 * @param {string} machine - machine id
 * @returns {object} lane state
 */
function laneState(lanes, machine) {
    if (!lanes.has(machine)) {
        lanes.set(machine, { queue: Promise.resolve(), pending: null, timer: null });
    }
    return lanes.get(machine);
}

/**
 * Builds the coalesce key for a pending heartbeat.
 *
 * @param {object} parsed - raw segment JSON
 * @returns {string} coalesce key
 */
function heartbeatKey(parsed) {
    const kind = typeof parsed.kind === 'string' && parsed.kind.length > 0 ? parsed.kind : 'phase';
    return `${parsed.machine}\0${kind}\0${parsed.start}`;
}

/**
 * Whether the payload is a pending open-segment heartbeat.
 *
 * @param {object} parsed - raw segment JSON
 * @returns {boolean}
 */
function isHeartbeat(parsed) {
    return parsed.type === 'segment' && parsed.duration === 0;
}

/**
 * Flushes a buffered pending heartbeat batch through the codec.
 *
 * @param {object} lane - lane state
 * @param {object} codec - downstream codec
 * @returns {Promise<void>}
 */
async function flushLane(lane, codec) {
    const batch = lane.pending;
    if (!batch) {
        return;
    }
    lane.pending = null;
    if (lane.timer) {
        clearTimeout(lane.timer);
        lane.timer = null;
    }
    try {
        await codec.accept({ destination: batch.destination, payload: batch.payload });
        for (const settle of batch.settles) {
            settle.ack();
        }
    } catch (error) {
        for (const settle of batch.settles) {
            settle.nack();
        }
        throw error;
    }
}

/**
 * Buffers or flushes one pending heartbeat on a lane.
 *
 * @param {object} ctx - lane context with api/size/intervalMs
 * @param {object} envelope - STOMP envelope
 * @param {object} parsed - parsed payload
 * @returns {Promise<void>}
 */
async function bufferHeartbeat(ctx, envelope, parsed) {
    const key = heartbeatKey(parsed);
    const { api, lane, size, intervalMs } = ctx;
    if (lane.pending && lane.pending.key === key) {
        lane.pending.payload = envelope.payload;
        lane.pending.settles.push(envelope.settle);
    } else {
        await api.flush(lane);
        const pending = {
            key,
            destination: envelope.destination,
            payload: envelope.payload,
            settles: [envelope.settle]
        };
        const timer = setTimeout(() => {
            lane.queue = lane.queue.then(() => {
                return api.flush(lane);
            });
        }, intervalMs);
        Object.assign(lane, { pending, timer });
    }
    if (lane.pending && lane.pending.settles.length >= size) {
        await api.flush(lane);
    }
}

/**
 * Handles one envelope on a machine lane.
 *
 * @param {object} ctx - lane context
 * @param {object} envelope - STOMP envelope with settle
 * @param {object} parsed - parsed payload
 * @returns {Promise<void>}
 */
async function step(ctx, envelope, parsed) {
    if (isHeartbeat(parsed)) {
        await bufferHeartbeat(ctx, envelope, parsed);
        return;
    }
    await ctx.api.flush(ctx.lane);
    try {
        await ctx.codec.accept({ destination: envelope.destination, payload: envelope.payload });
        envelope.settle.ack();
    } catch (error) {
        envelope.settle.nack();
        throw error;
    }
}

/**
 * Coalesces pending segment heartbeats per machine before the codec.
 *
 * Expects STOMP envelopes with manual settle: `{ destination, payload, settle }`.
 * Consecutive `type=segment` + `duration=0` messages that share
 * `(machine, kind, start)` keep only the latest payload; all settles ack
 * after one successful downstream accept. Retag, split, completed segments,
 * and key changes flush immediately. Machines run on independent lanes.
 *
 * @param {object} codec - Downstream collector with accept({destination, payload})
 * @param {object} [options] - Coalesce tuning
 * @param {number} [options.size=50] - Max pending heartbeats before forced flush
 * @param {number} [options.interval=2] - Flush interval in seconds
 * @returns {object} Collector with accept(envelope)
 *
 * @example
 *   const coalesce = segmentCoalesce(segmentCodec(dispatch), { size: 50, interval: 2 });
 *   await coalesce.accept({ destination, payload, settle });
 */
export default function segmentCoalesce(codec, options = {}) {
    if (!codec || typeof codec.accept !== 'function') {
        throw new Error('Codec must have an accept() method');
    }
    const size = options.size || 50;
    const intervalMs = (options.interval || 2) * 1000;
    const lanes = new Map();
    const api = {
        accept(envelope) {
            const parsed = JSON.parse(envelope.payload);
            const lane = laneState(lanes, parsed.machine);
            const ctx = { api, lane, codec, size, intervalMs };
            lane.queue = lane.queue.then(() => {
                return step(ctx, envelope, parsed);
            });
            return lane.queue;
        },
        async flush(lane) {
            await flushLane(lane, codec);
        }
    };
    return api;
}
