import segmentBatch from './segmentBatch.js';
import segmentTransaction from '../sinks/segmentTransaction.js';
import { decodeSegment } from '../codecs/segmentCodec.js';

/** Decode before enqueue; every command and receipt remains ordered until durable commit. */
export default function segmentTransactions(dispatch, pool, config, onFatal) {
    const options = config.transactions;
    const writer = segmentTransaction(pool, dispatch, { timeoutMs: options.timeoutMs, onFatal });
    const batch = segmentBatch(records => { return writer.write(records); }, {
        ...options, prefetch: config.prefetch, deadLetter: config.deadLetter,
        stopTimeoutMs: config.stopTimeoutMs, onFatal, onAbort(error) { writer.abort(error); }, onBatch: config.onBatch
    });
    return {
        accept(envelope) {
            try {
                return batch.accept({ record: decodeSegment(envelope), settle: envelope.settle, bytes: Buffer.byteLength(envelope.payload) });
            } catch (error) {
                envelope.settle.nack(!(config.deadLetter && error.permanent));
                return Promise.reject(error);
            }
        },
        abort(error) { batch.abort(error); },
        stop() { return batch.stop(); }
    };
}
