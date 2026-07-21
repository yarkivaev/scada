import processingErrorLog from '../processingErrorLog.js';

function parseStartTime(parsed) {
    const startTime = new Date(parsed.start * 1000);
    if (isNaN(startTime.getTime())) {
        throw new RangeError(`Invalid epoch timestamp: ${parsed.start}`);
    }
    return startTime;
}

function parseDecidedAt(parsed) {
    if (parsed.decided_at === undefined || parsed.decided_at === null) {
        return new Date().toISOString();
    }
    const decided = new Date(parsed.decided_at * 1000);
    if (isNaN(decided.getTime())) {
        throw new RangeError(`Invalid decided_at timestamp: ${parsed.decided_at}`);
    }
    return decided.toISOString();
}

function decisionRecord(raw, parsed, startTime, decidedAt) {
    const record = {
        machine: parsed.machine,
        startTime: startTime.toISOString(),
        username: parsed.user,
        payload: raw.payload,
        decidedAt
    };
    if (parsed.operator_id !== undefined && parsed.operator_id !== null) {
        record.operatorId = Number(parsed.operator_id);
    }
    return record;
}

/**
 * Codec for converting raw STOMP user decision messages to sink-ready records.
 *
 * Parses JSON payloads and extracts machine, start timestamp, user, operator_id,
 * decided_at, and the full raw payload for audit storage.
 *
 * @example
 *   const codec = userDecisionCodec(collector);
 *   codec.accept({ destination: '/exchange/scada.user_decisions',
 *                  payload: '{"machine":"icht2","start":1700000000,"user":"op1","operator_id":2}' });
 *
 * @param {object} collector - Collector with accept() method
 * @returns {object} Codec with accept() method
 */
export default function userDecisionCodec(collector) {
    if (!collector || typeof collector.accept !== 'function') {
        throw new Error('Collector must have an accept() method');
    }
    return {
        /**
         * Accepts a raw STOMP message and forwards the decoded record to the collector.
         *
         * @param {object} raw - Raw message with destination and payload
         */
        async accept(raw) {
            try {
                const parsed = JSON.parse(raw.payload);
                if (typeof parsed.machine !== 'string') {
                    throw new Error('Decision missing machine field');
                }
                if (typeof parsed.user !== 'string') {
                    throw new Error('Decision missing user field');
                }
                const startTime = parseStartTime(parsed);
                const decidedAt = parseDecidedAt(parsed);
                await collector.accept(decisionRecord(raw, parsed, startTime, decidedAt));
            } catch (error) {
                processingErrorLog('decision_codec', error, { destination: raw.destination, payload: raw.payload });
                throw error;
            }
        }
    };
}
