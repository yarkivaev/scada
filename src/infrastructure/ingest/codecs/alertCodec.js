import processingErrorLog from '../processingErrorLog.js';

/**
 * Codec for converting raw STOMP alert messages to PostgreSQL-ready records.
 *
 * Parses JSON payloads and extracts name, machine, severity, status,
 * and timestamps. Translates rule names to human-readable messages
 * using the provided translation map. Converts epoch timestamps to
 * ISO strings for PostgreSQL TIMESTAMPTZ columns.
 *
 * @example
 *   const codec = alertCodec(collector, { low_cosphi: 'Выключить переключатель компенсации' });
 *   codec.accept({ destination: '/exchange/scada.alerts', payload: '{"name":"low_cosphi","machine":"icht2","severity":"warning","status":"pending","start":1700000000}' });
 *
 * @param {object} collector - Collector with accept() method
 * @param {object} translations - Map of rule names to human-readable messages
 * @returns {object} Codec with accept() method
 */
export default function alertCodec(collector, translations) {
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
                if (typeof parsed.name !== 'string') {
                    throw new Error('Alert missing name field');
                }
                if (typeof parsed.machine !== 'string') {
                    throw new Error('Alert missing machine field');
                }
                const timestamp = new Date(parsed.start);
                if (isNaN(timestamp.getTime())) {
                    throw new RangeError(`Invalid epoch timestamp: ${parsed.start}`);
                }
                await collector.accept({
                    name: parsed.name,
                    message: translations[parsed.name] || parsed.name,
                    machine: parsed.machine,
                    severity: parsed.severity,
                    status: parsed.status,
                    timestamp: timestamp.toISOString()
                });
            } catch (error) {
                processingErrorLog('alert_codec', error, { destination: raw.destination, payload: raw.payload });
                throw error;
            }
        }
    };
}
