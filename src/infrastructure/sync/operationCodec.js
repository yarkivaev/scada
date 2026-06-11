import processingErrorLog from '../ingest/processingErrorLog.js';

function parseOccurredAt(value) {
    const timestamp = new Date(value);
    if (isNaN(timestamp.getTime())) {
        throw new RangeError(`Invalid occurred_at: ${value}`);
    }
    return timestamp;
}

/**
 * Codec for converting AMQP operation sync messages to PostgreSQL-ready records.
 *
 * @param {object} collector - Collector with accept() method
 * @returns {object} Codec with accept() method
 *
 * @example
 *   const codec = operationCodec(collector);
 *   await codec.accept(Buffer.from('{"machine":"icht1","occurred_at":"2024-06-01T10:00:00.000Z","kind":"chem","external_key":"nb-1","payload":{}}'));
 */
export default function operationCodec(collector) {
    if (!collector || typeof collector.accept !== 'function') {
        throw new Error('Collector must have an accept() method');
    }
    return {
        async accept(content) {
            try {
                const parsed = JSON.parse(content.toString());
                if (typeof parsed.machine !== 'string') {
                    throw new Error('Operation missing machine field');
                }
                if (typeof parsed.kind !== 'string') {
                    throw new Error('Operation missing kind field');
                }
                if (typeof parsed.external_key !== 'string') {
                    throw new Error('Operation missing external_key field');
                }
                if (typeof parsed.payload !== 'object' || parsed.payload === null || Array.isArray(parsed.payload)) {
                    throw new Error('Operation missing payload field');
                }
                const occurred = parseOccurredAt(parsed.occurred_at);
                await collector.accept({
                    machine: parsed.machine,
                    occurred_at: occurred,
                    kind: parsed.kind,
                    key: parsed.external_key,
                    payload: parsed.payload
                });
            } catch (error) {
                processingErrorLog('operation_codec', error, { content: content.toString() });
                throw error;
            }
        }
    };
}
