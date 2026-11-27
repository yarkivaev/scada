import segmentNormalize from '../../../domain/segment/normalize.js';
import { writeFence } from '../../persistence/pg/segmentWriteFence.js';
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

const maxTransitionPieces = 128;

function transitionRecord(parsed) {
    if (typeof parsed.machine !== 'string' || !Array.isArray(parsed.pieces) ||
        parsed.pieces.length < 2 || parsed.pieces.length > maxTransitionPieces) {
        throw new Error('Invalid phase transition envelope');
    }
    const pieces = parsed.pieces.map((piece) => {
        return segmentNormalize({ ...piece, type: 'segment', kind: 'phase', machine: parsed.machine });
    });
    if (pieces.at(-1).duration !== 0 || pieces.slice(0, -1).some((piece, index) => {
        return piece.duration <= 0 || piece.end_time !== pieces[index + 1].start_time;
    })) {
        throw new Error('A phase transition must close adjacent phases and open the next');
    }
    return { type: 'phase-transition', machine: parsed.machine, pieces };
}

function persistedRecord(parsed) {
    if (parsed.type === 'split-family') { return familyRecord(parsed); }
    if (parsed.type === 'phase-transition') { return transitionRecord(parsed); }
    return segmentNormalize(parsed);
}

export function decodeSegmentBody(parsed) {
    const {fence,committedOutputId,...body} = parsed;
    delete body.epoch;
    const record = persistedRecord(body);
    if (Object.hasOwn(parsed,'fence')) {
        writeFence(fence);
        if (typeof fence.revision !== 'string' || !/^[0-9]+$/u.test(fence.revision)) {
            throw new TypeError('Expected segment revision required');
        }
        return {...record,fence,body};
    }
    if (Object.hasOwn(parsed,'committedOutputId')) {
        writeFence({outputId:committedOutputId});
        return {...record,committedOutputId,body};
    }
    return record;
}

/** Decode once before admission so invalid envelopes never enter a transaction batch. */
export function decodeSegment(raw) {
    try {
        return decodeSegmentBody(JSON.parse(raw.payload));
    } catch (error) {
        error.permanent = true;
        throw error;
    }
}

export default function segmentCodec(collector) {
    if (!collector || typeof collector.accept !== 'function') {
        throw new Error('Collector must have an accept() method');
    }
    return {
        async accept(raw) {
            try { await collector.accept(decodeSegment(raw)); }
            catch (error) {
                processingErrorLog('segment_codec', error, { destination: raw.destination, payload: raw.payload });
                throw error;
            }
        }
    };
}
