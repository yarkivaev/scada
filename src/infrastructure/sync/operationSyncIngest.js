import durableConsume from '../ingest/durableConsume.js';
import operationCodec from './operationCodec.js';
import operationSyncSink from './operationSyncSink.js';

/**
 * Decodes one AMQP operation message body through the codec.
 *
 * @param {object} codec - operationCodec instance
 * @param {Buffer} content - message body
 * @returns {Promise<void>}
 */
export function acceptOperationDeliver(codec, content) {
    return codec.accept(content);
}

/**
 * Builds a queue consumer callback bound to one AMQP channel.
 *
 * @param {object} codec - operationCodec instance
 * @param {object} channel - amqplib channel with ack(msg)
 * @returns {Function} consume callback for ch.consume
 */
export function operationConsumer(codec, channel) {
    return async (msg) => {
        if (!msg) {
            return;
        }
        await acceptOperationDeliver(codec, msg.content);
        channel.ack(msg);
    };
}

/**
 * AMQP queue consumer that UPSERTs federated operation events into central PG.
 *
 * @param {string} amqpUrl - RabbitMQ AMQP URL
 * @param {string} queue - Durable queue name to consume
 * @param {object} operations - Operations port with upsert(item)
 * @param {object} [options] - prefetch options
 * @returns {object} consumer with start and stop
 *
 * @example
 *   const ingest = operationSyncIngest(amqpUrl, 'scada.operations.ingest', dataAccess.operations);
 *   await ingest.start();
 */
function subscribeOperations(queue, prefetch, codec) {
    return async (channel) => {
        await channel.assertQueue(queue, { durable: true });
        channel.prefetch(prefetch);
        const onMessage = operationConsumer(codec, channel);
        const tag = await channel.consume(queue, onMessage, { noAck: false });
        return tag.consumerTag;
    };
}

export default function operationSyncIngest(amqpUrl, queue, operations, options = {}) {
    const prefetch = options.prefetch || 32;
    const sink = operationSyncSink(operations);
    const codec = operationCodec(sink);
    const session = durableConsume(
        amqpUrl,
        subscribeOperations(queue, prefetch, codec),
        options
    );
    return {
        start() {
            return session.start();
        },
        stop() {
            return session.stop();
        }
    };
}
