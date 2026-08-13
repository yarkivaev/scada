import processingErrorLog from '../ingest/processingErrorLog.js';

function parseOccurredAt(value) {
    const timestamp = new Date(value);
    if (isNaN(timestamp.getTime())) {
        throw new RangeError(`Invalid occurred_at: ${value}`);
    }
    return timestamp;
}

function requireString(parsed, field) {
    if (typeof parsed[field] !== 'string') {
        throw new Error(`Operation missing ${field} field`);
    }
}

function requirePayload(parsed) {
    if (typeof parsed.payload !== 'object' || parsed.payload === null || Array.isArray(parsed.payload)) {
        throw new Error('Operation missing payload field');
    }
}

function identity(parsed) {
    requireString(parsed, 'machine');
    requireString(parsed, 'kind');
    requireString(parsed, 'external_key');
    return {
        machine: parsed.machine,
        occurred_at: parseOccurredAt(parsed.occurred_at),
        kind: parsed.kind,
        key: parsed.external_key
    };
}

async function decode(parsed, collector) {
    const record = identity(parsed);
    if (parsed.type === 'deleted') {
        if (typeof collector.remove !== 'function') {
            throw new Error('Collector must have a remove() method');
        }
        await collector.remove(record);
        return;
    }
    requirePayload(parsed);
    await collector.accept({ ...record, payload: parsed.payload });
}

/**
 * Codec for converting AMQP operation sync messages to PostgreSQL-ready records.
 *
 * Upsert messages require payload. Deleted messages (type=deleted) call collector.remove.
 *
 * @param {object} collector - Collector with accept() and optional remove()
 * @returns {object} Codec with accept() method
 *
 * @example
 *   const codec = operationCodec(collector);
 *   await codec.accept(Buffer.from('{"machine":"m1","occurred_at":"2024-06-01T10:00:00.000Z","kind":"sample","external_key":"nb-1","payload":{}}'));
 *   await codec.accept(Buffer.from('{"type":"deleted","machine":"m1","occurred_at":"2024-06-01T10:00:00.000Z","kind":"load","external_key":"k"}'));
 */
export default function operationCodec(collector) {
    if (!collector || typeof collector.accept !== 'function') {
        throw new Error('Collector must have an accept() method');
    }
    return {
        async accept(content) {
            try {
                await decode(JSON.parse(content.toString()), collector);
            } catch (error) {
                processingErrorLog('operation_codec', error, { content: content.toString() });
                throw error;
            }
        }
    };
}
