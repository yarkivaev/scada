import segmentNormalize from '../../../domain/segment/normalize.js';
import processingErrorLog from '../processingErrorLog.js';

/**
 * Codec for converting raw STOMP segment messages to PostgreSQL-ready records.
 *
 * @param {object} collector - Collector with accept() method
 * @returns {object} Codec with accept() method
 *
 * @example
 *   const codec = segmentCodec(collector);
 *   codec.accept({ destination: '/exchange/scada.segments', payload: '{"machine":"m2","name":"on","start":1700000000,"end":1700003600,"duration":3600}' });
 */
function familyRecord(parsed) {
    if (typeof parsed.machine !== 'string' || !Array.isArray(parsed.pieces) || parsed.pieces.length === 0) {
        throw new Error('split-family missing machine or pieces');
    }
    return {
        type: 'split-family',
        machine: parsed.machine,
        origin: parsed.origin,
        pieces: parsed.pieces.map((piece) => {
            return segmentNormalize({ ...piece, type: 'split', machine: parsed.machine });
        })
    };
}

export default function segmentCodec(collector) {
    if (!collector || typeof collector.accept !== 'function') {
        throw new Error('Collector must have an accept() method');
    }
    return {
        async accept(raw) {
            try {
                const parsed = JSON.parse(raw.payload);
                if (parsed.type === 'split-family') {
                    await collector.accept(familyRecord(parsed));
                    return;
                }
                const record = segmentNormalize(parsed);
                await collector.accept(record);
            } catch (error) {
                processingErrorLog('segment_codec', error, { destination: raw.destination, payload: raw.payload });
                throw error;
            }
        }
    };
}
