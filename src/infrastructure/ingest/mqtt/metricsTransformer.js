/**
 * Transformer for converting raw MQTT messages to metrics records.
 *
 * Parses payloads as JSON. Accepts either a raw number or an object
 * with a value field. Logs when payload cannot be resolved to a
 * numeric value.
 *
 * @example
 *   const transformer = metricsTransformer(collector);
 *   transformer.accept({ topic: 'sensors/temp', payload: '42.5' });
 *   transformer.accept({ topic: 'sensors/temp', payload: '{"ts":123,"value":42}' });
 *
 * @param {object} collector - Collector with accept() method
 * @param {object} [log] - Logger with warn() method
 * @returns {object} Transformer with accept() method
 */
export default function metricsCodec(collector, log = console) {
    if (!collector || typeof collector.accept !== 'function') {
        throw new Error('Collector must have an accept() method');
    }
    return {
        /**
         * Accepts raw MQTT message and transforms to metrics record.
         *
         * @param {object} raw - Raw message with topic and payload
         */
        accept(raw) {
            let parsed;
            try {
                parsed = JSON.parse(raw.payload);
            } catch {
                log.warn(`Cannot resolve payload on ${raw.topic}: not valid JSON`);
                return;
            }
            if (typeof parsed === 'number') {
                collector.accept({
                    topic: raw.topic,
                    ts: Date.now(),
                    value: parsed
                });
                return;
            }
            if (typeof parsed === 'object' && parsed !== null && typeof parsed.value === 'number') {
                collector.accept({
                    topic: raw.topic,
                    ts: parsed.ts || Date.now(),
                    value: parsed.value
                });
                return;
            }
            log.warn(`Cannot resolve payload on ${raw.topic}: no numeric value found`);
        }
    };
}
