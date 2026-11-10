import deliverySpool from '../../infrastructure/persistence/runtime/deliverySpool.js';
import deliverySessions from './deliverySessions.js';
import deliveryOperations from './deliveryOperations.js';

function confirmed(event) {
    return { ...event, options: { ...event.options, persistent: true, mandatory: true, messageId: event.eventId } };
}
function snapshot(operation, checkBytes) {
    const json = JSON.stringify(operation); checkBytes(Buffer.byteLength(json));
    const frozen = JSON.parse(json);
    if (frozen.kind === 'append') { frozen.recipients = frozen.event.destinations.map((item) => { return item.id; }); }
    return { operation: frozen, bytes: Buffer.byteLength(JSON.stringify(frozen)) };
}
/* eslint max-lines-per-function: ["error", 125], max-statements: ["error", 25] */
/** Node-owned queue: every point/receipt resolves only after its grouped FULL commit. */
export default function deliveryQueue(directory, options) {
    const spool = deliverySpool(directory, options);
    const commands = deliveryOperations((operations) => { return spool.mutateMany(operations); }, options);
    const sessions = deliverySessions(options.factory, options.writeTimeoutMs);
    const batchSize = options.batchSize ?? 100;
    if (!Number.isSafeInteger(batchSize) || batchSize <= 0) { throw new TypeError('Positive safe batchSize required'); }
    const receiptWindow = Math.min(options.groupCommit?.maxRecords ?? 64, options.maxOperations ?? 128);
    const state = { draining: false, closed: false, full: false };
    async function publish(record, id) {
        if (state.closed) { throw new Error('Delivery queue closed'); }
        // Reserve the eventual receipt BEFORE publication; confirmation can never lose its admission slot.
        const receipt = commands.prepare((checkBytes) => { return snapshot({ kind: 'ack', eventId: record.event.eventId, recipient: id }, checkBytes); });
        try {
            const descriptor = record.event.destinations.find((item) => { return item.id === id; });
            await sessions.write(descriptor, confirmed(record.event.observation));
            return { receipt: receipt.commit() };
        } catch (error) { receipt.cancel(); throw error; }
    }
    async function drain() {
        state.draining = true;
        const result = { delivered: 0, failed: 0 };
        const receipts = [];
        function failure(error) {
            result.failed += 1;
            try { options.onError?.(error); } catch {
                // Observers cannot prevent independent recipient progress or release.
            }
        }
        async function flush() { commands.flush(); await Promise.all(receipts.splice(0)); }
        async function receive(row, id) {
            try {
                const sent = await publish(row, id);
                receipts.push(sent.receipt.then(() => { result.delivered += 1; }, failure));
            } catch (error) { failure(error); }
            if (receipts.length >= receiptWindow) { await flush(); }
        }
        try {
            const rows = await commands.barrier(() => { return spool.pending(batchSize); });
            Object.assign(state, { full: rows.length === batchSize });
            for (const row of rows) {
                for (const id of row.remaining) {
                    // eslint-disable-next-line no-await-in-loop
                    await receive(row, id);
                }
            }
            return result;
        } finally { try { await flush(); } finally { Object.assign(state, { draining: false }); } }
    }
    return {
        open() {
            if (state.closed) { return Promise.reject(new Error('Delivery queue closed')); }
            return commands.barrier(() => { return spool.open(); });
        },
        accept(event, destinations) {
            if (state.closed) { return Promise.reject(new Error('Delivery queue closed')); }
            if (!destinations?.length || destinations.some((item) => { return item.type !== 'amqp'; })) {
                return Promise.reject(new TypeError('Queued delivery requires confirmed AMQP destinations'));
            }
            return commands.mutate((checkBytes) => { return snapshot({ kind: 'append', event: { eventId: event.eventId, observation: event, destinations } }, checkBytes); });
        },
        drain() {
            if (state.draining || state.closed) { return Promise.resolve({ delivered: 0, failed: 0 }); }
            const result = drain(); state.activeDrain = result; return result;
        },
        close() {
            state.closed = true; commands.flush();
            state.closing ??= (async () => {
                await state.activeDrain?.catch(() => {
                    // Drain caller receives the original error.
                });
                await commands.idle();
                try { await sessions.close(); } finally { await spool.close(); }
            })();
            return state.closing;
        },
        status() {
            const usage = commands.status();
            return { ...spool.status(), queuedOperations: usage.operations, queuedBytes: usage.bytes, drainFull: state.full };
        }
    };
}
