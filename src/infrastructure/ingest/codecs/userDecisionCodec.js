import processingErrorLog from '../processingErrorLog.js';

/**
 * Codec for converting raw STOMP user decision messages to sink-ready records.
 *
 * Parses JSON payloads and extracts machine, start timestamp, user, and the
 * full raw payload for audit storage. Converts epoch timestamps to ISO strings.
 * Throws on missing required fields.
 *
 * @example
 *   const codec = userDecisionCodec(collector);
 *   codec.accept({ destination: '/exchange/scada.user_decisions',
 *                  payload: '{"machine":"icht2","start":1700000000,"user":"op1","tags":[]}' });
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
                const startTime = new Date(parsed.start);
                if (isNaN(startTime.getTime())) {
                    throw new RangeError(`Invalid epoch timestamp: ${parsed.start}`);
                }
                await collector.accept({
                    machine: parsed.machine,
                    startTime: startTime.toISOString(),
                    username: parsed.user,
                    payload: raw.payload
                });
            } catch (error) {
                processingErrorLog('decision_codec', error, { destination: raw.destination, payload: raw.payload });
                throw error;
            }
        }
    };
}
